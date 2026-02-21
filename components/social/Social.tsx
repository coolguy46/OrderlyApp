'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { searchUsersByEmail } from '@/lib/supabase/services';
import type { Profile } from '@/lib/supabase/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '@/components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, cn } from '@/lib/utils';
import {
  Users,
  UserPlus,
  UserX,
  Trophy,
  Medal,
  Crown,
  Flame,
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

  const [activeTab, setActiveTab] = useState<'friends' | 'competitions' | 'leaderboard'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [pendingSendIds, setPendingSendIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadFriends();
  }, []);

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
        streak: user?.current_streak || 0,
        tasksCompleted: user?.tasks_completed || 0,
        initial: (user?.full_name?.[0] || 'U').toUpperCase(),
        isYou: true,
      },
      ...acceptedFriends.map((f) => ({
        name: f.profile.full_name || f.profile.email || 'Unknown',
        studyTime: f.profile.total_study_time || 0,
        streak: f.profile.current_streak || 0,
        tasksCompleted: f.profile.tasks_completed || 0,
        initial: (f.profile.full_name?.[0] || f.profile.email?.[0] || '?').toUpperCase(),
        isYou: false,
      })),
    ].sort((a, b) => b.studyTime - a.studyTime);
    return entries;
  }, [user, acceptedFriends]);

  // Search for users by email
  const handleSearch = useCallback(
    async (query: string) => {
      setAddSearchQuery(query);
      if (query.length < 3 || !user) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const results = await searchUsersByEmail(query, user.id);
        // Filter out existing relationships
        setSearchResults(results.filter((r) => !existingRelationIds.has(r.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [user, existingRelationIds]
  );

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
          { id: 'competitions' as const, label: 'Competitions', icon: Trophy },
          { id: 'leaderboard' as const, label: 'Leaderboard', icon: Medal },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all',
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
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
            {/* Search & Add */}
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search your friends..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button onClick={() => setShowAddFriend(!showAddFriend)} variant={showAddFriend ? 'secondary' : 'default'}>
                {showAddFriend ? (
                  <>
                    <X className="w-4 h-4 mr-2" />
                    Close
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add Friend
                  </>
                )}
              </Button>
            </div>

            {/* Add Friend Search Panel */}
            <AnimatePresence>
              {showAddFriend && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <Card className="border-primary/30">
                    <CardContent className="p-4 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Search by email address to add a friend
                      </p>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                        <Input
                          type="text"
                          placeholder="Search by email..."
                          value={addSearchQuery}
                          onChange={(e) => handleSearch(e.target.value)}
                          className="pl-10"
                        />
                        {isSearching && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
                        )}
                      </div>

                      {/* Search Results */}
                      {searchResults.length > 0 && (
                        <div className="space-y-2">
                          {searchResults.map((result) => (
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
                        </div>
                      )}

                      {addSearchQuery.length >= 3 && !isSearching && searchResults.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          No users found matching &ldquo;{addSearchQuery}&rdquo;
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

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
                    whileHover={{ scale: 1.01 }}
                    className="bg-card border border-border rounded-xl p-4 group hover:border-primary/30 transition-all"
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
                            <Flame className="w-3 h-3 text-orange-500" />
                            {friend.profile.current_streak || 0}
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
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title="Remove friend"
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              !showAddFriend &&
              pendingReceived.length === 0 &&
              pendingSent.length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-1">No friends yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Search by email to connect with other students
                    </p>
                    <Button onClick={() => setShowAddFriend(true)}>
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add Your First Friend
                    </Button>
                  </CardContent>
                </Card>
              )
            )}
          </motion.div>
        )}

        {/* ======================== COMPETITIONS TAB ======================== */}
        {activeTab === 'competitions' && (
          <motion.div
            key="competitions"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Trophy className="w-14 h-14 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-1">Competitions Coming Soon</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Challenge your friends to study time battles, task completion races, and more.
                  Stay tuned!
                </p>
              </CardContent>
            </Card>
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
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
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
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.1 }}
                        className="text-center"
                      >
                        <Crown className="w-7 h-7 mx-auto text-yellow-500 mb-1" />
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
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3 }}
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
                    {leaderboard.map((participant, index) => {
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
                                <Flame className="w-3 h-3 text-orange-500" />
                                {participant.streak} day streak
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
                                <Flame className="w-3 h-3 text-orange-500" />
                                {participant.streak} day streak
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
