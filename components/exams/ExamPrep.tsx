'use client';

import { useState, useEffect, useRef } from 'react';
import { Task, Exam } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Badge, Input, Label, Textarea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Progress, Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui';
import {
  BookOpen, Brain, RotateCcw, CheckCircle2, XCircle,
  Plus, Trash2, Upload, FileText, FlipHorizontal,
  ChevronLeft, ChevronRight, ChevronDown, Zap, Trophy, Target,
  GraduationCap, Calculator, PenTool, Clock, Star,
} from 'lucide-react';
import { toast } from 'sonner';

// ─────────────────── Types ───────────────────

interface Flashcard {
  id: string;
  front: string;
  back: string;
  subject?: string;
}

interface MCQQuestion {
  id: string;
  question: string;
  options: string[];
  correct: number; // index of correct option
  explanation?: string;
  subject?: string;
}

interface StudySet {
  id: string;
  examId?: string;
  name: string;
  flashcards: Flashcard[];
  mcqs: MCQQuestion[];
  files: { name: string; url: string; type: string }[];
  linkedTaskIds: string[];
  createdAt: string;
}

// ─────────────────── Flashcard Component ───────────────────

function FlashcardPlayer({ cards, onBack }: { cards: Flashcard[]; onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [unknown, setUnknown] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);

  const card = cards[index];
  const progress = (index / cards.length) * 100;

  const handleKnow = () => {
    setKnown(prev => new Set([...prev, index]));
    advance();
  };
  const handleDontKnow = () => {
    setUnknown(prev => new Set([...prev, index]));
    advance();
  };
  const advance = () => {
    setFlipped(false);
    setTimeout(() => {
      if (index < cards.length - 1) setIndex(i => i + 1);
      else setDone(true);
    }, 150);
  };

  if (done) {
    const score = Math.round((known.size / cards.length) * 100);
    return (
      <div className="text-center py-12 space-y-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
          <Trophy className="w-10 h-10 text-green-400" />
        </motion.div>
        <div>
          <h3 className="text-2xl font-bold">{score}%</h3>
          <p className="text-muted-foreground">Cards you knew: {known.size} / {cards.length}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => { setIndex(0); setFlipped(false); setKnown(new Set()); setUnknown(new Set()); setDone(false); }}>
            <RotateCcw className="w-4 h-4 mr-2" /> Restart
          </Button>
          <Button onClick={onBack}><ChevronLeft className="w-4 h-4 mr-2" /> Back to Sets</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <span className="text-sm text-muted-foreground">{index + 1} / {cards.length}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-400">✓ {known.size}</span>
          <span className="text-red-400">✗ {unknown.size}</span>
        </div>
      </div>

      <Progress value={progress} className="h-1.5" />

      {/* Flashcard */}
      <div className="flex items-center justify-center py-2">
        <motion.div
          className="w-full max-w-lg h-56 cursor-pointer"
          onClick={() => setFlipped(!flipped)}
          style={{ perspective: 1000 }}
        >
          <motion.div
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ duration: 0.4, type: 'spring', stiffness: 200, damping: 20 }}
            style={{ transformStyle: 'preserve-3d', position: 'relative', width: '100%', height: '100%' }}
          >
            {/* Front */}
            <div style={{ backfaceVisibility: 'hidden', position: 'absolute', width: '100%', height: '100%' }}
              className="rounded-2xl border border-border bg-gradient-to-br from-indigo-500/10 to-purple-500/10 flex flex-col items-center justify-center p-8 text-center">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Question</p>
              <p className="text-lg font-semibold">{card?.front}</p>
              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1"><FlipHorizontal className="w-3 h-3" /> Tap to reveal</p>
            </div>
            {/* Back */}
            <div style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', position: 'absolute', width: '100%', height: '100%' }}
              className="rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500/10 to-emerald-500/10 flex flex-col items-center justify-center p-8 text-center">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Answer</p>
              <p className="text-lg font-semibold text-green-400">{card?.back}</p>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" onClick={handleDontKnow} className="flex-1 max-w-36 border-red-500/30 text-red-400 hover:bg-red-500/10">
          <XCircle className="w-4 h-4 mr-2" /> Still Learning
        </Button>
        <Button onClick={handleKnow} className="flex-1 max-w-36 bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30">
          <CheckCircle2 className="w-4 h-4 mr-2" /> Got It!
        </Button>
      </div>
    </div>
  );
}

// ─────────────────── MCQ Player ───────────────────

function MCQPlayer({ questions, onBack }: { questions: MCQQuestion[]; onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  const q = questions[index];

  const handleSelect = (optIdx: number) => {
    if (answered) return;
    setSelected(optIdx);
    setAnswered(true);
    if (optIdx === q.correct) setScore(s => s + 1);
  };

  const handleNext = () => {
    setSelected(null);
    setAnswered(false);
    setShowExplanation(false);
    if (index < questions.length - 1) setIndex(i => i + 1);
    else setDone(true);
  };

  if (done) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="text-center py-12 space-y-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-20 h-20 mx-auto rounded-full bg-indigo-500/20 flex items-center justify-center">
          <Brain className="w-10 h-10 text-indigo-400" />
        </motion.div>
        <div>
          <h3 className="text-3xl font-bold">{pct}%</h3>
          <p className="text-muted-foreground">{score} / {questions.length} correct</p>
          <p className="text-sm text-muted-foreground mt-1">{pct >= 80 ? '🎉 Excellent work!' : pct >= 60 ? '👍 Good effort!' : '📚 Keep studying!'}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => { setIndex(0); setSelected(null); setAnswered(false); setScore(0); setDone(false); }}>
            <RotateCcw className="w-4 h-4 mr-2" /> Retry
          </Button>
          <Button onClick={onBack}><ChevronLeft className="w-4 h-4 mr-2" /> Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <span className="text-sm text-muted-foreground">Q{index + 1} / {questions.length}</span>
        <span className="text-sm font-medium text-green-400">{score} pts</span>
      </div>

      <Progress value={(index / questions.length) * 100} className="h-1.5" />

      <div className="p-5 bg-muted/30 rounded-2xl border border-border">
        <p className="font-semibold text-base">{q.question}</p>
      </div>

      <div className="space-y-2.5">
        {q.options.map((opt, i) => {
          let style = 'border-border hover:border-primary/50 hover:bg-muted/50';
          if (answered) {
            if (i === q.correct) style = 'border-green-500/50 bg-green-500/10 text-green-400';
            else if (i === selected && i !== q.correct) style = 'border-red-500/50 bg-red-500/10 text-red-400';
          }
          return (
            <motion.button
              key={i}
              whileHover={!answered ? { scale: 1.01 } : {}}
              whileTap={!answered ? { scale: 0.99 } : {}}
              onClick={() => handleSelect(i)}
              className={cn('w-full text-left p-3.5 rounded-xl border transition-all flex items-center gap-3', style, !answered && 'cursor-pointer')}
            >
              <span className="w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold flex-shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="text-sm">{opt}</span>
              {answered && i === q.correct && <CheckCircle2 className="w-4 h-4 text-green-400 ml-auto" />}
              {answered && i === selected && i !== q.correct && <XCircle className="w-4 h-4 text-red-400 ml-auto" />}
            </motion.button>
          );
        })}
      </div>

      {answered && (
        <div className="space-y-3">
          {q.explanation && (
            <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-sm text-blue-300">
              <span className="font-medium">Explanation: </span>{q.explanation}
            </div>
          )}
          <Button onClick={handleNext} className="w-full">
            {index < questions.length - 1 ? 'Next Question' : 'See Results'}
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────── StudySet Manager ───────────────────

function StudySetManager({ studySet, onBack }: { studySet: StudySet; onBack: (updated: StudySet) => void }) {
  const { tasks } = useAppStore();
  const [set, setSet] = useState(studySet);
  const [mode, setMode] = useState<'overview' | 'flashcards' | 'mcq' | 'addCard' | 'addMCQ'>('overview');
  const [newCard, setNewCard] = useState({ front: '', back: '', subject: '' });
  const [newMCQ, setNewMCQ] = useState({ question: '', options: ['', '', '', ''], correct: 0, explanation: '', subject: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (updated: StudySet) => {
    setSet(updated);
    const all: StudySet[] = JSON.parse(localStorage.getItem('studySets') || '[]');
    const idx = all.findIndex(s => s.id === updated.id);
    if (idx >= 0) all[idx] = updated;
    else all.push(updated);
    localStorage.setItem('studySets', JSON.stringify(all));
  };

  const handleAddCard = () => {
    if (!newCard.front || !newCard.back) return;
    const updated = { ...set, flashcards: [...set.flashcards, { id: crypto.randomUUID(), ...newCard }] };
    save(updated);
    setNewCard({ front: '', back: '', subject: '' });
    toast.success('Flashcard added');
  };

  const handleAddMCQ = () => {
    if (!newMCQ.question || newMCQ.options.some(o => !o)) return;
    const updated = { ...set, mcqs: [...set.mcqs, { id: crypto.randomUUID(), ...newMCQ }] };
    save(updated);
    setNewMCQ({ question: '', options: ['', '', '', ''], correct: 0, explanation: '', subject: '' });
    toast.success('MCQ added');
  };

  const handleDeleteCard = (id: string) => {
    save({ ...set, flashcards: set.flashcards.filter(c => c.id !== id) });
  };

  const handleDeleteMCQ = (id: string) => {
    save({ ...set, mcqs: set.mcqs.filter(m => m.id !== id) });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        const updated = { ...set, files: [...set.files, { name: file.name, url, type: file.type }] };
        save(updated);
        toast.success(`${file.name} uploaded`);
      };
      reader.readAsDataURL(file);
    });
  };

  const toggleTask = (taskId: string) => {
    const linked = set.linkedTaskIds.includes(taskId)
      ? set.linkedTaskIds.filter(id => id !== taskId)
      : [...set.linkedTaskIds, taskId];
    save({ ...set, linkedTaskIds: linked });
  };

  if (mode === 'flashcards') return <FlashcardPlayer cards={set.flashcards} onBack={() => setMode('overview')} />;
  if (mode === 'mcq') return <MCQPlayer questions={set.mcqs} onBack={() => setMode('overview')} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => onBack(set)}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <h3 className="font-semibold">{set.name}</h3>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="glow-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{set.flashcards.length}</p>
            <p className="text-xs text-muted-foreground">Flashcards</p>
          </CardContent>
        </Card>
        <Card className="glow-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{set.mcqs.length}</p>
            <p className="text-xs text-muted-foreground">MCQs</p>
          </CardContent>
        </Card>
        <Card className="glow-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{set.files.length}</p>
            <p className="text-xs text-muted-foreground">Files</p>
          </CardContent>
        </Card>
      </div>

      {/* Study buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => setMode('flashcards')} disabled={set.flashcards.length === 0} className="gap-2 h-12 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30">
          <FlipHorizontal className="w-5 h-5" /> Study Flashcards
        </Button>
        <Button onClick={() => setMode('mcq')} disabled={set.mcqs.length === 0} className="gap-2 h-12 bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30">
          <Brain className="w-5 h-5" /> Take MCQ Quiz
        </Button>
      </div>

      {/* Tabs: Flashcards / MCQs / Files / Tasks */}
      <div className="space-y-4">
        {/* Add Flashcard */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2"><FlipHorizontal className="w-4 h-4 text-indigo-400" /> Flashcards ({set.flashcards.length})</h4>
            <Button size="sm" variant="outline" onClick={() => setMode(mode === 'addCard' ? 'overview' : 'addCard')}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          <AnimatePresence>
            {mode === 'addCard' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Front (Question)</Label>
                      <Textarea value={newCard.front} onChange={e => setNewCard(p => ({ ...p, front: e.target.value }))} placeholder="Enter question..." rows={2} className="text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Back (Answer)</Label>
                      <Textarea value={newCard.back} onChange={e => setNewCard(p => ({ ...p, back: e.target.value }))} placeholder="Enter answer..." rows={2} className="text-sm" />
                    </div>
                  </div>
                  <Button size="sm" onClick={handleAddCard} disabled={!newCard.front || !newCard.back}>Add Card</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="space-y-2">
            {set.flashcards.map((card, i) => (
              <div key={card.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border text-sm group">
                <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <p className="truncate">{card.front}</p>
                  <p className="truncate text-muted-foreground">{card.back}</p>
                </div>
                <button onClick={() => handleDeleteCard(card.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Add MCQ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" /> MCQ Questions ({set.mcqs.length})</h4>
            <Button size="sm" variant="outline" onClick={() => setMode(mode === 'addMCQ' ? 'overview' : 'addMCQ')}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          <AnimatePresence>
            {mode === 'addMCQ' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Question</Label>
                    <Textarea value={newMCQ.question} onChange={e => setNewMCQ(p => ({ ...p, question: e.target.value }))} placeholder="Enter question..." rows={2} className="text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {newMCQ.options.map((opt, i) => (
                      <div key={i} className="space-y-1">
                        <Label className="text-xs flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-muted border flex items-center justify-center text-[10px]">{String.fromCharCode(65 + i)}</span>
                          {newMCQ.correct === i && <span className="text-green-400 text-[10px]">✓ Correct</span>}
                        </Label>
                        <Input value={opt} onChange={e => {
                          const opts = [...newMCQ.options];
                          opts[i] = e.target.value;
                          setNewMCQ(p => ({ ...p, options: opts }));
                        }} placeholder={`Option ${String.fromCharCode(65 + i)}`} className="h-8 text-sm" />
                        <button type="button" onClick={() => setNewMCQ(p => ({ ...p, correct: i }))} className="text-xs text-muted-foreground hover:text-green-400 transition-colors">
                          Set as correct
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Explanation (optional)</Label>
                    <Input value={newMCQ.explanation} onChange={e => setNewMCQ(p => ({ ...p, explanation: e.target.value }))} placeholder="Explain the answer..." className="text-sm" />
                  </div>
                  <Button size="sm" onClick={handleAddMCQ} disabled={!newMCQ.question || newMCQ.options.some(o => !o)}>Add Question</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="space-y-2">
            {set.mcqs.map((q, i) => (
              <div key={q.id} className="p-3 bg-muted/30 rounded-xl border border-border group">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{i + 1}. {q.question}</p>
                  <button onClick={() => handleDeleteMCQ(q.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.options.map((opt, oi) => (
                    <span key={oi} className={cn('text-xs px-2 py-0.5 rounded-full', oi === q.correct ? 'bg-green-500/20 text-green-400' : 'bg-muted text-muted-foreground')}>
                      {String.fromCharCode(65 + oi)}) {opt}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* File Upload */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" /> Study Materials ({set.files.length})</h4>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="w-3 h-3 mr-1" /> Upload
            </Button>
            <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" className="hidden" onChange={handleFileUpload} />
          </div>
          <div className="space-y-2">
            {set.files.map((file, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border text-sm group">
                <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="flex-1 truncate">{file.name}</span>
                <a href={file.url} download={file.name} className="text-xs text-indigo-400 hover:underline">Download</a>
                <button onClick={() => save({ ...set, files: set.files.filter((_, fi) => fi !== i) })} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {set.files.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed border-border rounded-xl">
                <Upload className="w-6 h-6 mx-auto mb-2 opacity-50" />
                Upload notes, slides, or study guides
              </div>
            )}
          </div>
        </div>

        {/* Linked Tasks */}
        <div className="space-y-3">
          <h4 className="font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> Related Tasks</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {tasks.filter(t => t.status !== 'completed').slice(0, 20).map(task => (
              <button
                key={task.id}
                onClick={() => toggleTask(task.id)}
                className={cn(
                  'w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-all text-sm',
                  set.linkedTaskIds.includes(task.id)
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                    : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <CheckCircle2 className={cn('w-4 h-4 flex-shrink-0', set.linkedTaskIds.includes(task.id) ? 'text-indigo-400' : 'text-muted-foreground')} />
                <span className="truncate">{task.title}</span>
                {task.due_date && (
                  <span className="text-xs ml-auto shrink-0">{new Date(task.due_date).toLocaleDateString()}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── SAT/ACT Prep ───────────────────

const SAT_SECTIONS = [
  {
    name: 'SAT Math', icon: Calculator, color: 'blue',
    topics: ['Algebra', 'Problem Solving & Data Analysis', 'Advanced Math', 'Geometry'],
    tips: ['Practice mental math', 'Learn key formulas', 'Time yourself on sections', 'Review wrong answers']
  },
  {
    name: 'SAT Reading & Writing', icon: BookOpen, color: 'green',
    topics: ['Reading Comprehension', 'Vocabulary in Context', 'Grammar', 'Evidence-Based Questions'],
    tips: ['Read actively', 'Eliminate wrong answers', 'Look for evidence', 'Practice paired passages']
  },
  {
    name: 'ACT English', icon: PenTool, color: 'purple',
    topics: ['Punctuation', 'Grammar & Usage', 'Sentence Structure', 'Rhetorical Skills'],
    tips: ['Read each sentence aloud mentally', 'Know comma rules', 'Watch for wordiness', 'Check transitions']
  },
  {
    name: 'ACT Math', icon: Calculator, color: 'indigo',
    topics: ['Pre-Algebra', 'Elementary Algebra', 'Intermediate Algebra', 'Coordinate Geometry', 'Plane Geometry', 'Trigonometry'],
    tips: ['Memorize formulas', 'Draw diagrams', 'Plug in numbers', 'Backsolve from answers']
  },
  {
    name: 'ACT Reading', icon: BookOpen, color: 'amber',
    topics: ['Literary Narrative', 'Social Science', 'Humanities', 'Natural Science'],
    tips: ['Preview questions first', 'Take brief notes', 'Watch the clock', 'Use process of elimination']
  },
  {
    name: 'ACT Science', icon: Zap, color: 'teal',
    topics: ['Data Representation', 'Research Summaries', 'Conflicting Viewpoints'],
    tips: ['Focus on charts/graphs', 'You don\'t need outside knowledge', 'Find patterns quickly', 'Read scientist hypotheses carefully']
  },
];

function SATACTPrepSection() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [targetScore, setTargetScore] = useState('');
  const [testType, setTestType] = useState<'SAT' | 'ACT'>('SAT');

  useEffect(() => {
    const saved = localStorage.getItem('satActScores');
    if (saved) try { setScores(JSON.parse(saved)); } catch {}
    const savedTarget = localStorage.getItem('satActTarget');
    if (savedTarget) setTargetScore(savedTarget);
    const savedType = localStorage.getItem('satActType');
    if (savedType) setTestType(savedType as 'SAT' | 'ACT');
  }, []);

  const saveScore = (section: string, score: number) => {
    const updated = { ...scores, [section]: score };
    setScores(updated);
    localStorage.setItem('satActScores', JSON.stringify(updated));
  };

  const filteredSections = SAT_SECTIONS.filter(s => s.name.startsWith(testType));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="p-5 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-2xl border border-indigo-500/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-indigo-400" />
              SAT/ACT Prep
            </h3>
            <p className="text-sm text-muted-foreground mt-1">Track your preparation for standardized tests</p>
          </div>
          <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-1">
            {(['SAT', 'ACT'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTestType(t); localStorage.setItem('satActType', t); }}
                className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all', testType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              >{t}</button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Target Score ({testType === 'SAT' ? '400–1600' : '1–36'})</Label>
            <Input
              type="number"
              placeholder={testType === 'SAT' ? '1550' : '34'}
              value={targetScore}
              onChange={e => { setTargetScore(e.target.value); localStorage.setItem('satActTarget', e.target.value); }}
              className="h-8 max-w-28"
            />
          </div>
          {targetScore && (
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-400">{targetScore}</p>
              <p className="text-xs text-muted-foreground">Target</p>
            </div>
          )}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {filteredSections.map(section => {
          const Icon = section.icon;
          const isOpen = expanded === section.name;
          const sectionScore = scores[section.name] || 0;

          return (
            <Card key={section.name} className={cn('glow-border overflow-hidden')}>
              <button
                className="w-full p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isOpen ? null : section.name)}
              >
                <div className={`p-2 rounded-xl bg-${section.color}-500/10`}>
                  <Icon className={`w-4 h-4 text-${section.color}-400`} />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-sm">{section.name}</p>
                  <p className="text-xs text-muted-foreground">{section.topics.length} topics</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold">{sectionScore}%</p>
                    <p className="text-xs text-muted-foreground">Progress</p>
                  </div>
                  <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </div>
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 space-y-4">
                      {/* Progress slider */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Section Progress</Label>
                          <span className="text-sm font-bold">{sectionScore}%</span>
                        </div>
                        <input
                          type="range"
                          min={0} max={100} step={5}
                          value={sectionScore}
                          onChange={e => saveScore(section.name, parseInt(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                        <Progress value={sectionScore} className="h-1.5" />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Topics */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Topics</p>
                          <div className="space-y-1.5">
                            {section.topics.map(topic => (
                              <div key={topic} className="flex items-center gap-2 text-xs">
                                <div className={`w-1.5 h-1.5 rounded-full bg-${section.color}-400`} />
                                <span>{topic}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Tips */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Study Tips</p>
                          <div className="space-y-1.5">
                            {section.tips.map(tip => (
                              <div key={tip} className="flex items-start gap-2 text-xs">
                                <Star className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                                <span className="text-muted-foreground">{tip}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────── Main ExamPrep Component ───────────────────

export function ExamPrep() {
  const { exams } = useAppStore();
  const [studySets, setStudySets] = useState<StudySet[]>([]);
  const [activeSet, setActiveSet] = useState<StudySet | null>(null);
  const [showNewSet, setShowNewSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetExamId, setNewSetExamId] = useState('');
  const [view, setView] = useState<'sets' | 'satact'>('sets');

  useEffect(() => {
    const saved = localStorage.getItem('studySets');
    if (saved) try { setStudySets(JSON.parse(saved)); } catch {}
  }, []);

  const handleCreateSet = () => {
    if (!newSetName.trim()) return;
    const newSet: StudySet = {
      id: crypto.randomUUID(),
      examId: newSetExamId || undefined,
      name: newSetName.trim(),
      flashcards: [],
      mcqs: [],
      files: [],
      linkedTaskIds: [],
      createdAt: new Date().toISOString(),
    };
    const updated = [...studySets, newSet];
    setStudySets(updated);
    localStorage.setItem('studySets', JSON.stringify(updated));
    setNewSetName('');
    setNewSetExamId('');
    setShowNewSet(false);
    setActiveSet(newSet);
    toast.success('Study set created!');
  };

  const handleDeleteSet = (id: string) => {
    const updated = studySets.filter(s => s.id !== id);
    setStudySets(updated);
    localStorage.setItem('studySets', JSON.stringify(updated));
  };

  const handleUpdateSet = (updated: StudySet) => {
    const all = studySets.map(s => s.id === updated.id ? updated : s);
    setStudySets(all);
    localStorage.setItem('studySets', JSON.stringify(all));
    setActiveSet(null);
  };

  if (activeSet) {
    return <StudySetManager studySet={activeSet} onBack={handleUpdateSet} />;
  }

  return (
    <div className="space-y-5">
      {/* View toggle */}
      <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-1.5 w-fit">
        <button
          onClick={() => setView('sets')}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5', view === 'sets' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <BookOpen className="w-3.5 h-3.5" /> Study Sets
        </button>
        <button
          onClick={() => setView('satact')}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5', view === 'satact' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <GraduationCap className="w-3.5 h-3.5" /> SAT / ACT
        </button>
      </div>

      {view === 'satact' ? (
        <SATACTPrepSection />
      ) : (
        <>
          {/* Create new set */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Study Sets ({studySets.length})</h3>
            <Button size="sm" onClick={() => setShowNewSet(true)} className="gap-1.5">
              <Plus className="w-4 h-4" /> New Set
            </Button>
          </div>

          {studySets.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-2xl">
              <Brain className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="font-medium">No study sets yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create a set to add flashcards and MCQs</p>
              <Button size="sm" onClick={() => setShowNewSet(true)} className="mt-4 gap-1.5">
                <Plus className="w-4 h-4" /> Create Study Set
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {studySets.map(set => {
                const linkedExam = exams.find(e => e.id === set.examId);
                return (
                  <motion.div key={set.id} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
                    <Card className="glow-border hover:shadow-md transition-all cursor-pointer group" onClick={() => setActiveSet(set)}>
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <h4 className="font-semibold">{set.name}</h4>
                            {linkedExam && (
                              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                <GraduationCap className="w-3 h-3" /> {linkedExam.title}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSet(set.id); }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all p-1.5 rounded-lg hover:bg-muted"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="p-2 bg-muted/50 rounded-xl">
                            <p className="text-lg font-bold">{set.flashcards.length}</p>
                            <p className="text-[10px] text-muted-foreground">Cards</p>
                          </div>
                          <div className="p-2 bg-muted/50 rounded-xl">
                            <p className="text-lg font-bold">{set.mcqs.length}</p>
                            <p className="text-[10px] text-muted-foreground">MCQs</p>
                          </div>
                          <div className="p-2 bg-muted/50 rounded-xl">
                            <p className="text-lg font-bold">{set.files.length}</p>
                            <p className="text-[10px] text-muted-foreground">Files</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* New Set Dialog */}
          <Dialog open={showNewSet} onOpenChange={setShowNewSet}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>Create Study Set</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label>Set Name</Label>
                  <Input placeholder="e.g., Calculus Midterm, Biology Chapter 5..." value={newSetName} onChange={e => setNewSetName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Link to Exam (optional)</Label>
                  <Select value={newSetExamId || 'none'} onValueChange={(v) => setNewSetExamId(v === 'none' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="Select exam..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No exam</SelectItem>
                      {exams.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowNewSet(false)} className="flex-1">Cancel</Button>
                  <Button onClick={handleCreateSet} disabled={!newSetName.trim()} className="flex-1">Create Set</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
