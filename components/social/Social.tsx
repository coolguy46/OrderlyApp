'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { searchUsersByEmail, type FriendSearchResult } from '@/lib/supabase/services';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '@/components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, cn } from '@/lib/utils';
import {
  Users,
  UserX,
  Medal,
  Crown,
  Clock,
  Target,
  Search,
  X,
  Check,
  Loader2,
  Inbox,
  Send,
} from 'lucide-react';

export function Social() {
  const {
    user,
    friends,
    loadFriends,
    sendFriendRequest,
    respondToFriendRequest,
    removeFriend,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'friends' | 'leaderboard'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [pendingSendIds, setPendingSendIds] = useState<Set<string>>(new Set());
  const searchGenerationRef = useRef(0);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  // Friends categorized
  const acceptedFriends = useMemo(
    () => friends.filter((f) => f.status === 'accepted'),
    [friends]
  );

  const pendingReceived = useMemo(
    () => friends.filter((f) => f.status === 'pending' && f.direction === 'received'),
    [friends]
  );

  const pendingSent = useMemo(
    () => friends.filter((f) => f.status === 'pending' && f.direction === 'sent'),
    [friends]
  );

  // IDs of people we already have a relationship with (to hide from search)
  const existingRelationIds = useMemo(
    () => new Set(friends.map((f) => f.profile.id)),
    [friends]
  );

  // Filter accepted friends by local search
  const filteredFriends = useMemo(
    () =>
      acceptedFriends.filter((f) =>
        f.profile.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.profile.email?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [acceptedFriends, searchQuery]
  );

  // Leaderboard: current user + accepted friends sorted by study time
  const leaderboard = useMemo(() => {
    const entries = [
      {
        name: user?.full_name || 'You',
        studyTime: user?.total_study_time || 0,
        tasksCompleted: user?.tasks_completed || 0,
        initial: (user?.full_name?.[0] || 'U').toUpperCase(),
        isYou: true,
      },
      ...acceptedFriends.map((f) => ({
        name: f.profile.full_name || f.profile.email || 'Unknown',
        studyTime: f.profile.total_study_time || 0,
        tasksCompleted: f.profile.tasks_completed || 0,
        initial: (f.profile.full_name?.[0] || f.profile.email?.[0] || '?').toUpperCase(),
        isYou: false,
      })),
    ].sort((a, b) => b.studyTime - a.studyTime);
    return entries;
  }, [user, acceptedFriends]);

  // Debounced exact-email lookup. Partial directory search would expose other
  // students' identities to enumeration.
  useEffect(() => {
    const requestGeneration = ++searchGenerationRef.current;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery.length < 5 || !user) {
      queueMicrotask(() => {
        if (searchGenerationRef.current !== requestGeneration) return;
        setSearchResults([]);
        setSearchResultsQuery('');
        setIsSearching(false);
      });
      return () => {
        if (searchGenerationRef.current === requestGeneration) {
          searchGenerationRef.current += 1;
        }
      };
    }

    const requestUserId = user.id;
    const isCurrentRequest = () => (
      searchGenerationRef.current === requestGeneration
      && useAppStore.getState().user?.id === requestUserId
    );

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchUsersByEmail(normalizedQuery, requestUserId);
        if (!isCurrentRequest()) return;
        setSearchResults(results.filter((r) => !existingRelationIds.has(r.id)));
        setSearchResultsQuery(normalizedQuery);
      } catch {
        if (!isCurrentRequest()) return;
        setSearchResults([]);
        setSearchResultsQuery(normalizedQuery);
      } finally {
        if (isCurrentRequest()) setIsSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      if (searchGenerationRef.current === requestGeneration) {
        searchGenerationRef.current += 1;
      }
    };
  }, [searchQuery, user, existingRelationIds]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleSearchResults = searchResultsQuery === normalizedSearchQuery
    ? searchResults
    : [];
  const showSearchProgress = normalizedSearchQuery.length >= 5
    && (isSearching || searchResultsQuery !== normalizedSearchQuery);

  const handleSendRequest = async (friendId: string) => {
    setPendingSendIds((prev) => new Set(prev).add(friendId));
    const success = await sendFriendRequest(friendId);
    if (success) {
      setSearchResults((prev) => prev.filter((r) => r.id !== friendId));
    }
    setPendingSendIds((prev) => {
      const next = new Set(prev);
      next.delete(friendId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1 w-fit">
        {[
          { id: 'friends' as const, label: 'Friends', icon: Users },
          { id: 'leaderboard' as const, label: 'Leaderboard', icon: Medal },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all',
              activeTab === tab.id
                ? 'text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="socialTabIndicator"
                className="absolute inset-0 bg-primary rounded-lg"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <tab.icon className="w-4 h-4 relative z-10" />
            <span className="relative z-10">{tab.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ======================== FRIENDS TAB ======================== */}
        {activeTab === 'friends' && (
          <motion.div
            key="friends"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* Unified Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                aria-label="Find a friend by email address"
                placeholder="Find a new friend by their exact email address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
              {showSearchProgress && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
              )}
            </div>

            {/* Add People Results (shown for a complete-looking email query) */}
            {normalizedSearchQuery.length >= 5 && (visibleSearchResults.length > 0 || showSearchProgress) && (
              <Card className="border-primary/30">
                <CardContent className="p-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Add People
                  </p>
                  {visibleSearchResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl"
                    >
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                        <span className="text-lg font-bold text-white">
                          {(result.full_name?.[0] || result.email?.[0] || '?').toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {result.full_name || 'No name'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{result.email}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSendRequest(result.id)}
                        disabled={pendingSendIds.has(result.id)}
                      >
                        {pendingSendIds.has(result.id) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5 mr-1.5" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                  {!showSearchProgress && visibleSearchResults.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No new users found matching &ldquo;{searchQuery}&rdquo;
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pending Requests */}
            {pendingReceived.length > 0 && (
              <Card className="border-yellow-500/30 bg-yellow-500/5">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-yellow-500" />
                    <CardTitle className="text-sm">
                      Friend Requests ({pendingReceived.length})
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pendingReceived.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center gap-3 p-3 bg-background rounded-xl border border-border"
                      >
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                          <span className="text-lg font-bold text-white">
                            {(req.profile.full_name?.[0] || '?').toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {req.profile.full_name || 'Unknown'}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{req.profile.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => respondToFriendRequest(req.id, true)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Decline friend request from ${req.profile.full_name || req.profile.email}`}
                            onClick={() => respondToFriendRequest(req.id, false)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pending Sent */}
            {pendingSent.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Sent Requests ({pendingSent.length})
                </p>
                {pendingSent.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 p-3 bg-muted/30 border border-border rounded-xl opacity-70"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/60 to-purple-600/60 flex items-center justify-center">
                      <span className="text-lg font-bold text-white">
                        {(req.profile.full_name?.[0] || '?').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {req.profile.full_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-muted-foreground">Pending...</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Friends List */}
            {filteredFriends.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredFriends.map((friend) => (
                  <motion.div
                    key={friend.id}
                    whileHover={{ scale: 1.02, y: -2 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                    className="bg-card border border-border rounded-xl p-4 group hover:border-primary/30 transition-all glow-border"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                        <span className="text-lg font-bold text-white">
                          {(friend.profile.full_name?.[0] || '?').toUpperCase()}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground truncate">
                          {friend.profile.full_name || friend.profile.email}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(friend.profile.total_study_time || 0)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Target className="w-3 h-3 text-green-500" />
                            {friend.profile.tasks_completed || 0}
                          </span>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeFriend(friend.id)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${friend.profile.full_name || friend.profile.email} from friends`}
                        title="Remove friend"
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              !searchQuery &&
              pendingReceived.length === 0 &&
              pendingSent.length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-1">No friends yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Type a name or email above to find and add other students
                    </p>
                  </CardContent>
                </Card>
              )
            )}
          </motion.div>
        )}

        {/* ======================== LEADERBOARD TAB ======================== */}
        {activeTab === 'leaderboard' && (
          <motion.div
            key="leaderboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {leaderboard.length <= 1 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Medal className="w-14 h-14 text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-1">Add Friends to See Rankings</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mb-4">
                    The leaderboard shows how you stack up against your friends.
                    Add some friends to get started!
                  </p>
                  <Button onClick={() => setActiveTab('friends')}>
                    <Users className="w-4 h-4 mr-2" />
                    Go to Friends
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Medal className="w-5 h-5 text-yellow-500" />
                    <CardTitle>Study Time Leaderboard</CardTitle>
                  </div>
                  <CardDescription>See how you rank among your friends</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Top 3 Podium */}
                  {leaderboard.length >= 3 && (
                    <div className="flex items-end justify-center gap-4 my-6">
                      {/* 2nd Place */}
                      <motion.div
                        initial={{ y: 50, opacity: 0, scale: 0.8 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                        className="text-center"
                      >
                        <div className="w-14 h-14 mx-auto rounded-xl bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center mb-2">
                          <span className="text-xl font-bold text-white">{leaderboard[1]?.initial}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground truncate w-20">
                          {leaderboard[1]?.isYou ? 'You' : leaderboard[1]?.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDuration(leaderboard[1]?.studyTime || 0)}
                        </p>
                        <div className="w-16 h-20 mt-2 bg-gradient-to-b from-gray-500 to-gray-600 rounded-t-lg flex items-center justify-center">
                          <span className="text-2xl font-bold text-white/80">2</span>
                        </div>
                      </motion.div>

                      {/* 1st Place */}
                      <motion.div
                        initial={{ y: 50, opacity: 0, scale: 0.8 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                        className="text-center"
                      >
                        <motion.div
                          animate={{ rotate: [0, -5, 5, 0] }}
                          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                        >
                          <Crown className="w-7 h-7 mx-auto text-yellow-500 mb-1" />
                        </motion.div>
                        <div className="w-16 h-16 mx-auto rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center mb-2 shadow-lg shadow-yellow-500/30">
                          <span className="text-2xl font-bold text-yellow-900">{leaderboard[0]?.initial}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground truncate w-20">
                          {leaderboard[0]?.isYou ? 'You' : leaderboard[0]?.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDuration(leaderboard[0]?.studyTime || 0)}
                        </p>
                        <div className="w-20 h-28 mt-2 bg-gradient-to-b from-yellow-500 to-yellow-600 rounded-t-lg flex items-center justify-center">
                          <span className="text-3xl font-bold text-yellow-900/80">1</span>
                        </div>
                      </motion.div>

                      {/* 3rd Place */}
                      <motion.div
                        initial={{ y: 50, opacity: 0, scale: 0.8 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
                        className="text-center"
                      >
                        <div className="w-14 h-14 mx-auto rounded-xl bg-gradient-to-br from-orange-600 to-orange-700 flex items-center justify-center mb-2">
                          <span className="text-xl font-bold text-white">{leaderboard[2]?.initial}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground truncate w-20">
                          {leaderboard[2]?.isYou ? 'You' : leaderboard[2]?.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDuration(leaderboard[2]?.studyTime || 0)}
                        </p>
                        <div className="w-16 h-14 mt-2 bg-gradient-to-b from-orange-600 to-orange-700 rounded-t-lg flex items-center justify-center">
                          <span className="text-xl font-bold text-white/80">3</span>
                        </div>
                      </motion.div>
                    </div>
                  )}

                  {/* Full list */}
                  <div className="space-y-2 mt-4">
                    {leaderboard.length >= 3 && leaderboard.map((participant, index) => {
                      // Skip top 3 if podium is shown
                      if (leaderboard.length >= 3 && index < 3) return null;
                      return (
                        <div
                          key={participant.name + index}
                          className={cn(
                            'flex items-center gap-4 p-3 rounded-xl transition-all',
                            participant.isYou ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
                          )}
                        >
                          <span className="w-8 text-center text-muted-foreground font-medium">#{index + 1}</span>
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                            <span className="text-lg font-bold text-white">{participant.initial}</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-foreground">
                              {participant.name}
                              {participant.isYou && <span className="ml-2 text-xs text-primary">(You)</span>}
                            </p>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDuration(participant.studyTime)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Target className="w-3 h-3 text-green-500" />
                                {participant.tasksCompleted} tasks
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* If fewer than 3, show all (no podium) */}
                    {leaderboard.length < 3 &&
                      leaderboard.map((participant, index) => (
                        <div
                          key={participant.name}
                          className={cn(
                            'flex items-center gap-4 p-3 rounded-xl transition-all',
                            participant.isYou ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
                          )}
                        >
                          <span className="w-8 text-center text-muted-foreground font-medium">#{index + 1}</span>
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                            <span className="text-lg font-bold text-white">{participant.initial}</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-foreground">
                              {participant.name}
                              {participant.isYou && <span className="ml-2 text-xs text-primary">(You)</span>}
                            </p>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDuration(participant.studyTime)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Target className="w-3 h-3 text-green-500" />
                                {participant.tasksCompleted} tasks
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
