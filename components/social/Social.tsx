'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardHeader, Button, Input, ProgressBar } from '@/components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, cn } from '@/lib/utils';
import {
  Users,
  UserPlus,
  Trophy,
  Medal,
  Crown,
  Flame,
  Clock,
  Target,
  Search,
  ChevronRight,
  Star,
} from 'lucide-react';

// Sample friends data
const SAMPLE_FRIENDS = [
  {
    id: '1',
    name: 'Sarah Johnson',
    email: 'sarah@student.edu',
    avatar: 'S',
    studyTime: 1850,
    streak: 12,
    tasksCompleted: 67,
    isOnline: true,
  },
  {
    id: '2',
    name: 'Mike Chen',
    email: 'mike@student.edu',
    avatar: 'M',
    studyTime: 2340,
    streak: 21,
    tasksCompleted: 89,
    isOnline: true,
  },
  {
    id: '3',
    name: 'Emily Davis',
    email: 'emily@student.edu',
    avatar: 'E',
    studyTime: 1560,
    streak: 8,
    tasksCompleted: 45,
    isOnline: false,
  },
  {
    id: '4',
    name: 'Alex Thompson',
    email: 'alex@student.edu',
    avatar: 'A',
    studyTime: 980,
    streak: 5,
    tasksCompleted: 32,
    isOnline: false,
  },
];

// Sample active competitions
const SAMPLE_COMPETITIONS = [
  {
    id: '1',
    title: 'Weekly Study Marathon',
    type: 'study_time',
    endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    participants: [
      { name: 'Mike Chen', avatar: 'M', score: 450 },
      { name: 'You', avatar: 'D', score: 380, isYou: true },
      { name: 'Sarah Johnson', avatar: 'S', score: 320 },
    ],
  },
  {
    id: '2',
    title: 'Task Completion Challenge',
    type: 'tasks_completed',
    endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    participants: [
      { name: 'You', avatar: 'D', score: 12, isYou: true },
      { name: 'Emily Davis', avatar: 'E', score: 10 },
      { name: 'Alex Thompson', avatar: 'A', score: 8 },
    ],
  },
];

export function Social() {
  const { user } = useAppStore();
  const [activeTab, setActiveTab] = useState<'friends' | 'competitions' | 'leaderboard'>('friends');
  const [searchQuery, setSearchQuery] = useState('');

  const allParticipants = [
    { name: user?.full_name || 'You', studyTime: user?.total_study_time || 0, streak: user?.current_streak || 0, isYou: true },
    ...SAMPLE_FRIENDS.map((f) => ({ name: f.name, studyTime: f.studyTime, streak: f.streak, isYou: false })),
  ].sort((a, b) => b.studyTime - a.studyTime);

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-2 bg-white/5 rounded-xl p-1.5 w-fit">
        {[
          { id: 'friends', label: 'Friends', icon: Users },
          { id: 'competitions', label: 'Competitions', icon: Trophy },
          { id: 'leaderboard', label: 'Leaderboard', icon: Medal },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-[clamp(0.65rem,1.5vw,0.75rem)] font-medium transition-all',
              activeTab === tab.id
                ? 'bg-indigo-500 text-white'
                : 'text-gray-400 hover:text-white'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Friends Tab */}
        {activeTab === 'friends' && (
          <motion.div
            key="friends"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Search and Add */}
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                <input
                  type="text"
                  placeholder="Search friends..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <Button>
                <UserPlus className="w-4 h-4" />
                Add Friend
              </Button>
            </div>

            {/* Friends List */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {SAMPLE_FRIENDS.filter((f) =>
                f.name.toLowerCase().includes(searchQuery.toLowerCase())
              ).map((friend) => (
                <motion.div
                  key={friend.id}
                  whileHover={{ scale: 1.02 }}
                  className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4 group hover:border-indigo-500/30 transition-all"
                >
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="relative">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                        <span className="text-lg font-bold text-white">{friend.avatar}</span>
                      </div>
                      {friend.isOnline && (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-900" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white truncate">{friend.name}</h3>
                      <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(friend.studyTime)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Flame className="w-3 h-3 text-orange-400" />
                          {friend.streak}
                        </span>
                      </div>
                    </div>

                    {/* Action */}
                    <button className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Competitions Tab */}
        {activeTab === 'competitions' && (
          <motion.div
            key="competitions"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Active Competitions</h3>
              <Button variant="secondary">
                <Trophy className="w-4 h-4" />
                Create Competition
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {SAMPLE_COMPETITIONS.map((competition) => {
                const daysLeft = Math.ceil(
                  (new Date(competition.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                );
                const yourPosition = competition.participants.findIndex((p) => p.isYou) + 1;

                return (
                  <Card key={competition.id} className="border-indigo-500/30">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                          {competition.type === 'study_time' ? (
                            <Clock className="w-5 h-5 text-indigo-400" />
                          ) : (
                            <Target className="w-5 h-5 text-indigo-400" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{competition.title}</h4>
                          <p className="text-xs text-gray-400">{daysLeft} days left</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-400">Your position</p>
                        <p className="text-xl font-bold text-white">#{yourPosition}</p>
                      </div>
                    </div>

                    {/* Leaderboard */}
                    <div className="space-y-2">
                      {competition.participants.map((participant, index) => (
                        <div
                          key={participant.name}
                          className={cn(
                            'flex items-center gap-3 p-2 rounded-lg',
                            participant.isYou ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-white/5'
                          )}
                        >
                          <div
                            className={cn(
                              'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                              index === 0
                                ? 'bg-yellow-500 text-yellow-900'
                                : index === 1
                                ? 'bg-gray-400 text-gray-900'
                                : index === 2
                                ? 'bg-orange-600 text-orange-100'
                                : 'bg-white/10 text-gray-400'
                            )}
                          >
                            {index + 1}
                          </div>
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-medium text-white">
                            {participant.avatar}
                          </div>
                          <span
                            className={cn(
                              'flex-1 text-sm',
                              participant.isYou ? 'text-white font-medium' : 'text-gray-300'
                            )}
                          >
                            {participant.name}
                          </span>
                          <span className="text-sm font-medium text-white">
                            {participant.score}
                            {competition.type === 'study_time' ? 'm' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'leaderboard' && (
          <motion.div
            key="leaderboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <Card>
              <CardHeader
                title="Study Time Leaderboard"
                subtitle="See how you rank among your friends"
                icon={<Medal className="w-5 h-5 text-yellow-400" />}
              />

              {/* Top 3 Podium */}
              <div className="flex items-end justify-center gap-4 my-8">
                {/* 2nd Place */}
                <motion.div
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-center"
                >
                  <div className="w-16 h-16 mx-auto rounded-xl bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center mb-2">
                    <span className="text-2xl font-bold text-white">
                      {allParticipants[1]?.name[0]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate w-24">
                    {allParticipants[1]?.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatDuration(allParticipants[1]?.studyTime || 0)}
                  </p>
                  <div className="w-20 h-24 mt-2 bg-gradient-to-b from-gray-500 to-gray-600 rounded-t-lg flex items-center justify-center">
                    <span className="text-3xl font-bold text-white/80">2</span>
                  </div>
                </motion.div>

                {/* 1st Place */}
                <motion.div
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="text-center"
                >
                  <Crown className="w-8 h-8 mx-auto text-yellow-400 mb-1" />
                  <div className="w-20 h-20 mx-auto rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center mb-2 shadow-lg shadow-yellow-500/30">
                    <span className="text-3xl font-bold text-yellow-900">
                      {allParticipants[0]?.name[0]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate w-24">
                    {allParticipants[0]?.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatDuration(allParticipants[0]?.studyTime || 0)}
                  </p>
                  <div className="w-24 h-32 mt-2 bg-gradient-to-b from-yellow-500 to-yellow-600 rounded-t-lg flex items-center justify-center">
                    <span className="text-4xl font-bold text-yellow-900/80">1</span>
                  </div>
                </motion.div>

                {/* 3rd Place */}
                <motion.div
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-center"
                >
                  <div className="w-16 h-16 mx-auto rounded-xl bg-gradient-to-br from-orange-600 to-orange-700 flex items-center justify-center mb-2">
                    <span className="text-2xl font-bold text-white">
                      {allParticipants[2]?.name[0]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate w-24">
                    {allParticipants[2]?.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatDuration(allParticipants[2]?.studyTime || 0)}
                  </p>
                  <div className="w-20 h-16 mt-2 bg-gradient-to-b from-orange-600 to-orange-700 rounded-t-lg flex items-center justify-center">
                    <span className="text-2xl font-bold text-white/80">3</span>
                  </div>
                </motion.div>
              </div>

              {/* Rest of the leaderboard */}
              <div className="space-y-2 mt-6">
                {allParticipants.slice(3).map((participant, index) => (
                  <div
                    key={participant.name}
                    className={cn(
                      'flex items-center gap-4 p-3 rounded-xl transition-all',
                      participant.isYou ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-white/5'
                    )}
                  >
                    <span className="w-8 text-center text-gray-400 font-medium">
                      #{index + 4}
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                      <span className="text-lg font-bold text-white">
                        {participant.name[0]}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-white">
                        {participant.name}
                        {participant.isYou && (
                          <span className="ml-2 text-xs text-indigo-400">(You)</span>
                        )}
                      </p>
                      <div className="flex items-center gap-3 text-sm text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(participant.studyTime)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Flame className="w-3 h-3 text-orange-400" />
                          {participant.streak} day streak
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
