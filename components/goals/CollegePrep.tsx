'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge, Input, Label, Textarea, Progress,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui';
import {
  GraduationCap, Plus, Trash2, Edit3, CheckCircle2,
  Trophy, Star, BookOpen, Users, Target, Calculator,
  Calendar, FileText, Award, TrendingUp, ChevronDown,
  ChevronUp, Percent, Clock, DollarSign, Heart,
  Activity, Lightbulb, PenTool, Building2, X,
  BarChart3, AlertCircle, CheckSquare, Mail,
} from 'lucide-react';
import { getDaysUntil } from '@/lib/utils';

// ─────────────────── Types ───────────────────

interface Course {
  id: string;
  name: string;
  grade: string;   // letter grade: A+, A, A-, B+, B, etc.
  credits: number;
  weighted: boolean; // AP / IB / Honors
  semester: string;
}

interface Extracurricular {
  id: string;
  name: string;
  role: string;
  category: 'sports' | 'arts' | 'academic' | 'volunteer' | 'work' | 'leadership' | 'other';
  yearsInvolved: number;
  hoursPerWeek: number;
  weeksPerYear: number;
  description: string;
  achievements?: string;
  highlighted: boolean;
}

interface College {
  id: string;
  name: string;
  type: 'reach' | 'match' | 'safety';
  deadline: string;
  deadlineType: 'ED' | 'EA' | 'RD' | 'Rolling';
  status: 'researching' | 'applying' | 'applied' | 'accepted' | 'rejected' | 'waitlisted' | 'deferred';
  notes: string;
  scholarships: boolean;
  essaysDone: number;
  essaysTotal: number;
}

interface Essay {
  id: string;
  title: string;
  prompt: string;
  wordLimit: number;
  status: 'not_started' | 'brainstorming' | 'drafting' | 'revising' | 'done';
  collegeId?: string;
  notes: string;
}

interface TestScore {
  id: string;
  test: 'SAT' | 'ACT' | 'SAT Subject' | 'AP' | 'IB' | 'TOEFL' | 'Other';
  score: number;
  maxScore: number;
  date: string;
  notes: string;
}

interface Recommendation {
  id: string;
  recommenderName: string;
  recommenderRole: string;
  status: 'not_asked' | 'asked' | 'confirmed' | 'submitted';
  deadline: string;
  notes: string;
}

// ─────────────────── GPA Calculator ───────────────────

const GRADE_POINTS: Record<string, { unweighted: number; weighted: number }> = {
  'A+': { unweighted: 4.0, weighted: 5.0 },
  'A':  { unweighted: 4.0, weighted: 5.0 },
  'A-': { unweighted: 3.7, weighted: 4.7 },
  'B+': { unweighted: 3.3, weighted: 4.3 },
  'B':  { unweighted: 3.0, weighted: 4.0 },
  'B-': { unweighted: 2.7, weighted: 3.7 },
  'C+': { unweighted: 2.3, weighted: 3.3 },
  'C':  { unweighted: 2.0, weighted: 3.0 },
  'C-': { unweighted: 1.7, weighted: 2.7 },
  'D+': { unweighted: 1.3, weighted: 2.3 },
  'D':  { unweighted: 1.0, weighted: 2.0 },
  'F':  { unweighted: 0.0, weighted: 0.0 },
};

function GPACalculator() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [newCourse, setNewCourse] = useState<Omit<Course, 'id'>>({
    name: '', grade: 'A', credits: 1, weighted: false, semester: 'Fall 2025'
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('collegeGPACourses');
    if (saved) try { setCourses(JSON.parse(saved)); } catch {}
  }, []);

  const save = (updated: Course[]) => {
    setCourses(updated);
    localStorage.setItem('collegeGPACourses', JSON.stringify(updated));
  };

  const gpa = useMemo(() => {
    if (courses.length === 0) return { unweighted: 0, weighted: 0, totalCredits: 0 };
    let unweightedPoints = 0, weightedPoints = 0, totalCredits = 0;
    for (const c of courses) {
      const pts = GRADE_POINTS[c.grade] || { unweighted: 0, weighted: 0 };
      const effectiveWeighted = c.weighted ? pts.weighted : pts.unweighted;
      unweightedPoints += pts.unweighted * c.credits;
      weightedPoints += effectiveWeighted * c.credits;
      totalCredits += c.credits;
    }
    return {
      unweighted: totalCredits > 0 ? Math.round((unweightedPoints / totalCredits) * 100) / 100 : 0,
      weighted: totalCredits > 0 ? Math.round((weightedPoints / totalCredits) * 100) / 100 : 0,
      totalCredits,
    };
  }, [courses]);

  const gpaColor = (g: number) =>
    g >= 3.7 ? 'text-green-400' : g >= 3.0 ? 'text-blue-400' : g >= 2.0 ? 'text-yellow-400' : 'text-red-400';

  const handleAdd = () => {
    if (!newCourse.name) return;
    const updated = editingId
      ? courses.map(c => c.id === editingId ? { ...c, ...newCourse } : c)
      : [...courses, { id: crypto.randomUUID(), ...newCourse }];
    save(updated);
    setNewCourse({ name: '', grade: 'A', credits: 1, weighted: false, semester: 'Fall 2025' });
    setShowAddCourse(false);
    setEditingId(null);
  };

  const semesters = [...new Set(courses.map(c => c.semester))].sort();

  return (
    <div className="space-y-5">
      {/* GPA Display */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card className="glow-border bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 col-span-1">
          <CardContent className="p-5 text-center">
            <p className={cn('text-4xl font-bold font-display', gpaColor(gpa.unweighted))}>
              {gpa.unweighted.toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Unweighted GPA</p>
            <Progress value={(gpa.unweighted / 4.0) * 100} className="h-1.5 mt-2" />
          </CardContent>
        </Card>
        <Card className="glow-border bg-gradient-to-br from-purple-500/10 to-purple-500/5 col-span-1">
          <CardContent className="p-5 text-center">
            <p className={cn('text-4xl font-bold font-display', gpaColor(gpa.weighted / 1.25))}>
              {gpa.weighted.toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Weighted GPA</p>
            <Progress value={(gpa.weighted / 5.0) * 100} className="h-1.5 mt-2" />
          </CardContent>
        </Card>
        <Card className="glow-border col-span-2 sm:col-span-1">
          <CardContent className="p-5 text-center">
            <p className="text-4xl font-bold font-display">{gpa.totalCredits}</p>
            <p className="text-sm text-muted-foreground mt-1">Total Credits</p>
            <p className="text-xs text-muted-foreground mt-1">{courses.length} courses</p>
          </CardContent>
        </Card>
      </div>

      {/* Add course button */}
      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-400" /> Courses
        </h4>
        <Button size="sm" onClick={() => { setEditingId(null); setNewCourse({ name: '', grade: 'A', credits: 1, weighted: false, semester: 'Fall 2025' }); setShowAddCourse(true); }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Course
        </Button>
      </div>

      {/* Add/Edit form */}
      <AnimatePresence>
        {showAddCourse && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-4 bg-muted/30 rounded-2xl border border-border space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1 space-y-1">
                  <Label className="text-xs">Course Name</Label>
                  <Input value={newCourse.name} onChange={e => setNewCourse(p => ({ ...p, name: e.target.value }))} placeholder="e.g., AP Calculus BC" className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Grade</Label>
                  <Select value={newCourse.grade} onValueChange={v => setNewCourse(p => ({ ...p, grade: v }))}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(GRADE_POINTS).map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Credits</Label>
                  <Input type="number" min="0.5" max="4" step="0.5" value={newCourse.credits} onChange={e => setNewCourse(p => ({ ...p, credits: parseFloat(e.target.value) || 1 }))} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Semester</Label>
                  <Input value={newCourse.semester} onChange={e => setNewCourse(p => ({ ...p, semester: e.target.value }))} placeholder="Fall 2025" className="h-8" />
                </div>
                <div className="flex items-end pb-1">
                  <button onClick={() => setNewCourse(p => ({ ...p, weighted: !p.weighted }))}
                    className={cn('flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-all', newCourse.weighted ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'border-border text-muted-foreground hover:text-foreground')}>
                    <div className={cn('w-3.5 h-3.5 rounded flex items-center justify-center border', newCourse.weighted ? 'bg-indigo-500 border-indigo-500' : 'border-muted-foreground')}>
                      {newCourse.weighted && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                    </div>
                    AP/IB/Honors
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowAddCourse(false); setEditingId(null); }}>Cancel</Button>
                <Button size="sm" onClick={handleAdd} disabled={!newCourse.name}>{editingId ? 'Update' : 'Add Course'}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Courses by semester */}
      {courses.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-border rounded-2xl text-muted-foreground">
          <Calculator className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Add courses to calculate your GPA</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(semesters.length > 0 ? semesters : ['All']).map(sem => {
            const semCourses = semesters.length > 0 ? courses.filter(c => c.semester === sem) : courses;
            return (
              <div key={sem}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{sem}</p>
                <div className="space-y-1.5">
                  {semCourses.map(course => {
                    const pts = GRADE_POINTS[course.grade] || { unweighted: 0, weighted: 0 };
                    return (
                      <div key={course.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border group text-sm hover:bg-muted/50 transition-colors">
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{course.name}</span>
                          {course.weighted && <Badge className="text-[10px] bg-indigo-500/20 text-indigo-400 border-indigo-500/30 shrink-0">Weighted</Badge>}
                        </div>
                        <span className={cn('font-bold w-8 text-center', gpaColor(pts.unweighted))}>{course.grade}</span>
                        <span className="text-muted-foreground w-16 text-right text-xs">{course.credits} cr</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingId(course.id); setNewCourse({ name: course.name, grade: course.grade, credits: course.credits, weighted: course.weighted, semester: course.semester }); setShowAddCourse(true); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button onClick={() => save(courses.filter(c => c.id !== course.id))} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Grade scale reference */}
      <details className="group">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1 select-none">
          <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" /> Grade point scale reference
        </summary>
        <div className="mt-2 grid grid-cols-4 sm:grid-cols-6 gap-1.5">
          {Object.entries(GRADE_POINTS).map(([g, pts]) => (
            <div key={g} className="text-center p-1.5 bg-muted/30 rounded-lg border border-border">
              <p className="text-xs font-bold">{g}</p>
              <p className="text-[10px] text-muted-foreground">{pts.unweighted.toFixed(1)}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ─────────────────── Extracurriculars ───────────────────

const EC_CATEGORIES = {
  sports: { label: 'Sports & Athletics', icon: Activity, color: 'green' },
  arts: { label: 'Arts & Performing', icon: PenTool, color: 'purple' },
  academic: { label: 'Academic & Research', icon: BookOpen, color: 'blue' },
  volunteer: { label: 'Volunteer & Community', icon: Heart, color: 'rose' },
  work: { label: 'Work & Internships', icon: Building2, color: 'amber' },
  leadership: { label: 'Leadership & Gov.', icon: Award, color: 'indigo' },
  other: { label: 'Other', icon: Star, color: 'gray' },
} as const;

function ExtracurricularsSection() {
  const [ecs, setEcs] = useState<Extracurricular[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEc, setEditingEc] = useState<Extracurricular | null>(null);
  const [form, setForm] = useState<Omit<Extracurricular, 'id'>>({
    name: '', role: '', category: 'academic', yearsInvolved: 1,
    hoursPerWeek: 3, weeksPerYear: 36, description: '', achievements: '', highlighted: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem('collegeECs');
    if (saved) try { setEcs(JSON.parse(saved)); } catch {}
  }, []);

  const save = (updated: Extracurricular[]) => {
    setEcs(updated);
    localStorage.setItem('collegeECs', JSON.stringify(updated));
  };

  const handleSave = () => {
    if (!form.name) return;
    if (editingEc) {
      save(ecs.map(e => e.id === editingEc.id ? { ...editingEc, ...form } : e));
    } else {
      save([...ecs, { id: crypto.randomUUID(), ...form }]);
    }
    setShowForm(false);
    setEditingEc(null);
    setForm({ name: '', role: '', category: 'academic', yearsInvolved: 1, hoursPerWeek: 3, weeksPerYear: 36, description: '', achievements: '', highlighted: false });
  };

  const openEdit = (ec: Extracurricular) => {
    setEditingEc(ec);
    setForm({ name: ec.name, role: ec.role, category: ec.category, yearsInvolved: ec.yearsInvolved, hoursPerWeek: ec.hoursPerWeek, weeksPerYear: ec.weeksPerYear, description: ec.description, achievements: ec.achievements || '', highlighted: ec.highlighted });
    setShowForm(true);
  };

  const totalHours = ecs.reduce((acc, e) => acc + e.hoursPerWeek * e.weeksPerYear, 0);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="glow-border"><CardContent className="p-4 text-center"><p className="text-3xl font-bold">{ecs.length}</p><p className="text-xs text-muted-foreground mt-1">Activities</p></CardContent></Card>
        <Card className="glow-border"><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-amber-400">{ecs.filter(e => e.highlighted).length}</p><p className="text-xs text-muted-foreground mt-1">Highlighted</p></CardContent></Card>
        <Card className="glow-border"><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-indigo-400">{Math.round(totalHours / 100) / 10}k</p><p className="text-xs text-muted-foreground mt-1">Total Hours</p></CardContent></Card>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-green-400" /> Activities ({ecs.length} / 10)</h4>
        <Button size="sm" onClick={() => { setEditingEc(null); setShowForm(true); }} disabled={ecs.length >= 10} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Activity
        </Button>
      </div>

      {ecs.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-border rounded-2xl text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Add up to 10 extracurricular activities</p>
          <p className="text-xs mt-1">(Common App allows 10)</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ecs.map((ec, i) => {
            const cfg = EC_CATEGORIES[ec.category];
            const Icon = cfg.icon;
            const annualHours = ec.hoursPerWeek * ec.weeksPerYear;
            return (
              <motion.div key={ec.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <Card className={cn('glow-border hover:shadow-md transition-all group', ec.highlighted && 'border-amber-500/30')}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn('p-2 rounded-xl shrink-0', `bg-${cfg.color}-500/10`)}>
                        <Icon className={cn('w-4 h-4', `text-${cfg.color}-400`)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{ec.name}</p>
                              {ec.highlighted && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
                              <Badge className={cn('text-[10px]', `bg-${cfg.color}-500/10 text-${cfg.color}-400 border-${cfg.color}-500/20`)}>{cfg.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{ec.role}</p>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button onClick={() => save(ecs.map(e => e.id === ec.id ? { ...e, highlighted: !e.highlighted } : e))} className={cn('p-1.5 rounded-lg transition-colors', ec.highlighted ? 'text-amber-400 hover:text-amber-500' : 'text-muted-foreground hover:text-amber-400')}><Star className="w-3.5 h-3.5" /></button>
                            <button onClick={() => openEdit(ec)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"><Edit3 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => save(ecs.filter(e => e.id !== ec.id))} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-muted"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        {ec.description && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{ec.description}</p>}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{ec.hoursPerWeek}h/wk · {ec.weeksPerYear}wks · {annualHours}h/yr</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{ec.yearsInvolved}yr{ec.yearsInvolved !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={open => !open && setShowForm(false)}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEc ? 'Edit Activity' : 'Add Extracurricular'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Activity Name *</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Robotics Club, Varsity Soccer..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Your Role / Position</Label>
                <Input value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} placeholder="e.g., President, Captain..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v as Extracurricular['category'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EC_CATEGORIES) as (keyof typeof EC_CATEGORIES)[]).map(k => (
                      <SelectItem key={k} value={k}>{EC_CATEGORIES[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Years Involved</Label>
                <Input type="number" min={1} max={12} value={form.yearsInvolved} onChange={e => setForm(p => ({ ...p, yearsInvolved: parseInt(e.target.value) || 1 }))} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hours / Week</Label>
                <Input type="number" min={0} max={168} value={form.hoursPerWeek} onChange={e => setForm(p => ({ ...p, hoursPerWeek: parseInt(e.target.value) || 0 }))} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Weeks / Year</Label>
                <Input type="number" min={1} max={52} value={form.weeksPerYear} onChange={e => setForm(p => ({ ...p, weeksPerYear: parseInt(e.target.value) || 1 }))} className="h-8" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (150 chars for Common App)</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What did you do? What impact did you make?" rows={2} maxLength={150} />
              <p className="text-[10px] text-muted-foreground text-right">{form.description.length}/150</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Honors / Achievements (optional)</Label>
              <Input value={form.achievements} onChange={e => setForm(p => ({ ...p, achievements: e.target.value }))} placeholder="Awards, recognition, achievements..." />
            </div>
            <button onClick={() => setForm(p => ({ ...p, highlighted: !p.highlighted }))}
              className={cn('flex items-center gap-2 text-sm px-3 py-2 rounded-xl border w-full transition-all', form.highlighted ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'border-border text-muted-foreground hover:text-foreground')}>
              <Star className={cn('w-4 h-4', form.highlighted && 'fill-amber-400')} />
              Mark as highlighted (top activity)
            </button>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => { setShowForm(false); setEditingEc(null); }} className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name} className="flex-1">{editingEc ? 'Update' : 'Add Activity'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────── College List ───────────────────

const STATUS_CONFIG = {
  researching: { label: 'Researching', color: 'text-muted-foreground', bg: 'bg-muted/50 border-border' },
  applying:    { label: 'Applying',    color: 'text-blue-400',          bg: 'bg-blue-500/10 border-blue-500/20' },
  applied:     { label: 'Applied',     color: 'text-indigo-400',        bg: 'bg-indigo-500/10 border-indigo-500/20' },
  accepted:    { label: 'Accepted 🎉', color: 'text-green-400',         bg: 'bg-green-500/10 border-green-500/20' },
  rejected:    { label: 'Rejected',    color: 'text-red-400',           bg: 'bg-red-500/10 border-red-500/20' },
  waitlisted:  { label: 'Waitlisted',  color: 'text-yellow-400',        bg: 'bg-yellow-500/10 border-yellow-500/20' },
  deferred:    { label: 'Deferred',    color: 'text-orange-400',        bg: 'bg-orange-500/10 border-orange-500/20' },
};

const TYPE_CONFIG = {
  reach:  { label: 'Reach',  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
  match:  { label: 'Match',  color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
  safety: { label: 'Safety', color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
};

function CollegeListSection() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingCollege, setEditingCollege] = useState<College | null>(null);
  const [form, setForm] = useState<Omit<College, 'id'>>({
    name: '', type: 'match', deadline: '', deadlineType: 'RD',
    status: 'researching', notes: '', scholarships: false, essaysDone: 0, essaysTotal: 1,
  });

  useEffect(() => {
    const saved = localStorage.getItem('collegeList');
    if (saved) try { setColleges(JSON.parse(saved)); } catch {}
  }, []);

  const save = (updated: College[]) => {
    setColleges(updated);
    localStorage.setItem('collegeList', JSON.stringify(updated));
  };

  const handleSave = () => {
    if (!form.name) return;
    if (editingCollege) {
      save(colleges.map(c => c.id === editingCollege.id ? { ...editingCollege, ...form } : c));
    } else {
      save([...colleges, { id: crypto.randomUUID(), ...form }]);
    }
    setShowForm(false);
    setEditingCollege(null);
    setForm({ name: '', type: 'match', deadline: '', deadlineType: 'RD', status: 'researching', notes: '', scholarships: false, essaysDone: 0, essaysTotal: 1 });
  };

  const stats = useMemo(() => ({
    total: colleges.length,
    reach: colleges.filter(c => c.type === 'reach').length,
    match: colleges.filter(c => c.type === 'match').length,
    safety: colleges.filter(c => c.type === 'safety').length,
    accepted: colleges.filter(c => c.status === 'accepted').length,
    applied: colleges.filter(c => ['applied', 'accepted', 'rejected', 'waitlisted', 'deferred'].includes(c.status)).length,
  }), [colleges]);

  const sorted = [...colleges].sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-foreground' },
          { label: 'Reach', value: stats.reach, color: 'text-red-400' },
          { label: 'Match', value: stats.match, color: 'text-blue-400' },
          { label: 'Safety', value: stats.safety, color: 'text-green-400' },
        ].map(s => (
          <Card key={s.label} className="glow-border">
            <CardContent className="p-3 text-center">
              <p className={cn('text-3xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.applied > 0 && (
        <div className="p-3 bg-muted/30 rounded-xl border border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium">Application Progress</span>
            <span className="text-sm text-muted-foreground">{stats.applied} / {stats.total} submitted</span>
          </div>
          <Progress value={stats.total > 0 ? (stats.applied / stats.total) * 100 : 0} className="h-2" />
          {stats.accepted > 0 && (
            <p className="text-xs text-green-400 mt-1.5 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {stats.accepted} acceptance{stats.accepted > 1 ? 's' : ''} so far!
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-400" /> College List</h4>
        <Button size="sm" onClick={() => { setEditingCollege(null); setShowForm(true); }} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add College
        </Button>
      </div>

      {colleges.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-border rounded-2xl text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Build your college list</p>
          <p className="text-xs mt-1">Aim for 3–4 reach, 3–4 match, 2–3 safety</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map(college => {
            const typeCfg = TYPE_CONFIG[college.type];
            const statusCfg = STATUS_CONFIG[college.status];
            const daysLeft = college.deadline ? getDaysUntil(college.deadline) : null;
            const essayPct = college.essaysTotal > 0 ? Math.round((college.essaysDone / college.essaysTotal) * 100) : 0;
            return (
              <Card key={college.id} className={cn('glow-border group hover:shadow-md transition-all', college.status === 'accepted' && 'border-green-500/30')}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">{college.name}</p>
                            <Badge className={cn('text-[10px] border', typeCfg.bg, typeCfg.color)}>{typeCfg.label}</Badge>
                            <Badge className={cn('text-[10px] border', statusCfg.bg, statusCfg.color)}>{statusCfg.label}</Badge>
                            {college.scholarships && <Badge className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">💰 Scholarship</Badge>}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            {college.deadline && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {college.deadlineType} · {new Date(college.deadline + 'T12:00:00').toLocaleDateString()}
                                {daysLeft !== null && daysLeft >= 0 && (
                                  <span className={cn('font-medium', daysLeft <= 7 ? 'text-red-400' : daysLeft <= 30 ? 'text-yellow-400' : 'text-muted-foreground')}>
                                    · {daysLeft}d left
                                  </span>
                                )}
                              </span>
                            )}
                            {college.essaysTotal > 0 && (
                              <span className="flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                Essays: {college.essaysDone}/{college.essaysTotal}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => { setEditingCollege(college); setForm({ name: college.name, type: college.type, deadline: college.deadline, deadlineType: college.deadlineType, status: college.status, notes: college.notes, scholarships: college.scholarships, essaysDone: college.essaysDone, essaysTotal: college.essaysTotal }); setShowForm(true); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"><Edit3 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => save(colleges.filter(c => c.id !== college.id))} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-muted"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      {college.essaysTotal > 0 && (
                        <div className="mt-2">
                          <Progress value={essayPct} className={cn('h-1', college.status === 'accepted' ? '[&>div]:bg-green-500' : '')} />
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={open => !open && setShowForm(false)}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingCollege ? 'Edit College' : 'Add College'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">College Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., MIT, Stanford, State University..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v as College['type'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reach">Reach 🔴</SelectItem>
                    <SelectItem value="match">Match 🔵</SelectItem>
                    <SelectItem value="safety">Safety 🟢</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as College['status'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_CONFIG) as College['status'][]).map(s => (
                      <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Deadline</Label>
                <Input type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Deadline Type</Label>
                <Select value={form.deadlineType} onValueChange={v => setForm(p => ({ ...p, deadlineType: v as College['deadlineType'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ED">ED (Early Decision)</SelectItem>
                    <SelectItem value="EA">EA (Early Action)</SelectItem>
                    <SelectItem value="RD">RD (Regular Decision)</SelectItem>
                    <SelectItem value="Rolling">Rolling</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Essays Done</Label>
                <Input type="number" min={0} value={form.essaysDone} onChange={e => setForm(p => ({ ...p, essaysDone: parseInt(e.target.value) || 0 }))} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Essays Total</Label>
                <Input type="number" min={0} value={form.essaysTotal} onChange={e => setForm(p => ({ ...p, essaysTotal: parseInt(e.target.value) || 0 }))} className="h-8" />
              </div>
            </div>
            <button onClick={() => setForm(p => ({ ...p, scholarships: !p.scholarships }))}
              className={cn('flex items-center gap-2 text-sm px-3 py-2 rounded-xl border w-full transition-all', form.scholarships ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'border-border text-muted-foreground hover:text-foreground')}>
              <DollarSign className="w-4 h-4" /> Applying for scholarships
            </button>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Requirements, contacts, portal info..." rows={2} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name} className="flex-1">{editingCollege ? 'Update' : 'Add College'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────── Test Scores ───────────────────

function TestScoresSection() {
  const [scores, setScores] = useState<TestScore[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<TestScore, 'id'>>({ test: 'SAT', score: 0, maxScore: 1600, date: '', notes: '' });

  const MAX_SCORES: Record<string, number> = { SAT: 1600, ACT: 36, 'SAT Subject': 800, AP: 5, IB: 7, TOEFL: 120, Other: 100 };

  useEffect(() => {
    const saved = localStorage.getItem('collegeTestScores');
    if (saved) try { setScores(JSON.parse(saved)); } catch {}
  }, []);

  const save = (updated: TestScore[]) => {
    setScores(updated);
    localStorage.setItem('collegeTestScores', JSON.stringify(updated));
  };

  const handleSave = () => {
    if (!form.score) return;
    save([...scores, { id: crypto.randomUUID(), ...form }]);
    setShowForm(false);
    setForm({ test: 'SAT', score: 0, maxScore: 1600, date: '', notes: '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-purple-400" /> Test Scores</h4>
        <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Score</Button>
      </div>

      {scores.length === 0 ? (
        <div className="text-center py-6 border-2 border-dashed border-border rounded-2xl text-muted-foreground text-sm">
          <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Track your SAT, ACT, AP, and other test scores
        </div>
      ) : (
        <div className="space-y-2">
          {scores.map(s => {
            const pct = Math.round((s.score / s.maxScore) * 100);
            const isHigh = pct >= 85;
            return (
              <div key={s.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border group">
                <div className={cn('p-2 rounded-xl', isHigh ? 'bg-green-500/10' : 'bg-muted')}>
                  <Trophy className={cn('w-4 h-4', isHigh ? 'text-green-400' : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{s.test}</span>
                    <span className={cn('text-lg font-bold', isHigh ? 'text-green-400' : 'text-foreground')}>{s.score}</span>
                    <span className="text-xs text-muted-foreground">/ {s.maxScore}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{s.date}</span>
                  </div>
                  <Progress value={pct} className={cn('h-1 mt-1', isHigh && '[&>div]:bg-green-500')} />
                </div>
                <button onClick={() => save(scores.filter(sc => sc.id !== s.id))} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-muted-foreground hover:text-red-400 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={open => !open && setShowForm(false)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader><DialogTitle>Add Test Score</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Test</Label>
              <Select value={form.test} onValueChange={v => setForm(p => ({ ...p, test: v as TestScore['test'], maxScore: MAX_SCORES[v] || 100 }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(MAX_SCORES).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Score</Label>
                <Input type="number" min={0} max={form.maxScore} value={form.score || ''} onChange={e => setForm(p => ({ ...p, score: parseInt(e.target.value) || 0 }))} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Score</Label>
                <Input type="number" value={form.maxScore} onChange={e => setForm(p => ({ ...p, maxScore: parseInt(e.target.value) || 100 }))} className="h-8" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date Taken</Label>
              <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="h-8" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={!form.score} className="flex-1">Add Score</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────── Recommendations ───────────────────

const REC_STATUS_CONFIG = {
  not_asked:  { label: 'Not Asked',  color: 'text-muted-foreground', step: 0 },
  asked:      { label: 'Asked',      color: 'text-yellow-400',       step: 1 },
  confirmed:  { label: 'Confirmed',  color: 'text-blue-400',         step: 2 },
  submitted:  { label: 'Submitted ✓', color: 'text-green-400',       step: 3 },
};

function RecommendationsSection() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<Recommendation, 'id'>>({ recommenderName: '', recommenderRole: '', status: 'not_asked', deadline: '', notes: '' });

  useEffect(() => {
    const saved = localStorage.getItem('collegeRecs');
    if (saved) try { setRecs(JSON.parse(saved)); } catch {}
  }, []);

  const save = (updated: Recommendation[]) => {
    setRecs(updated);
    localStorage.setItem('collegeRecs', JSON.stringify(updated));
  };

  const cycleStatus = (id: string) => {
    const order: Recommendation['status'][] = ['not_asked', 'asked', 'confirmed', 'submitted'];
    save(recs.map(r => {
      if (r.id !== id) return r;
      const idx = order.indexOf(r.status);
      return { ...r, status: order[(idx + 1) % order.length] };
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2"><Mail className="w-4 h-4 text-amber-400" /> Recommendations ({recs.length}/3)</h4>
        <Button size="sm" onClick={() => setShowForm(true)} disabled={recs.length >= 5} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add</Button>
      </div>

      {recs.length === 0 ? (
        <div className="text-center py-6 border-2 border-dashed border-border rounded-2xl text-muted-foreground text-sm">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Track your letters of recommendation
        </div>
      ) : (
        <div className="space-y-2">
          {recs.map(rec => {
            const cfg = REC_STATUS_CONFIG[rec.status];
            const daysLeft = rec.deadline ? getDaysUntil(rec.deadline) : null;
            return (
              <div key={rec.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border group">
                <button onClick={() => cycleStatus(rec.id)} className={cn('p-2 rounded-xl border shrink-0 transition-all hover:scale-105', rec.status === 'submitted' ? 'bg-green-500/10 border-green-500/30' : 'bg-muted border-border')}>
                  {rec.status === 'submitted' ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Mail className={cn('w-4 h-4', cfg.color)} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{rec.recommenderName}</span>
                    <Badge className={cn('text-[10px] border border-border bg-muted/50', cfg.color)}>{cfg.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{rec.recommenderRole}</p>
                  {rec.deadline && daysLeft !== null && (
                    <p className={cn('text-xs mt-0.5', daysLeft <= 14 ? 'text-yellow-400' : 'text-muted-foreground')}>
                      Deadline: {new Date(rec.deadline + 'T12:00:00').toLocaleDateString()} {daysLeft >= 0 ? `(${daysLeft}d)` : '(past)'}
                    </p>
                  )}
                </div>
                <button onClick={() => save(recs.filter(r => r.id !== rec.id))} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-muted-foreground hover:text-red-400 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={open => !open && setShowForm(false)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader><DialogTitle>Add Recommendation</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Recommender Name *</Label>
              <Input value={form.recommenderName} onChange={e => setForm(p => ({ ...p, recommenderName: e.target.value }))} placeholder="Dr. Smith, Mr. Johnson..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role / Title</Label>
              <Input value={form.recommenderRole} onChange={e => setForm(p => ({ ...p, recommenderRole: e.target.value }))} placeholder="AP Chemistry Teacher, Counselor..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as Recommendation['status'] }))}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REC_STATUS_CONFIG) as Recommendation['status'][]).map(s => <SelectItem key={s} value={s}>{REC_STATUS_CONFIG[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Deadline</Label>
                <Input type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} className="h-8" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
              <Button onClick={() => { if (!form.recommenderName) return; save([...recs, { id: crypto.randomUUID(), ...form }]); setShowForm(false); setForm({ recommenderName: '', recommenderRole: '', status: 'not_asked', deadline: '', notes: '' }); }} disabled={!form.recommenderName} className="flex-1">Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────── Main College Prep Tab ───────────────────

const sections = [
  { id: 'gpa',       label: 'GPA Calculator',    icon: Calculator,  color: 'indigo',  component: GPACalculator },
  { id: 'ecs',       label: 'Extracurriculars',  icon: Activity,    color: 'green',   component: ExtracurricularsSection },
  { id: 'colleges',  label: 'College List',      icon: Building2,   color: 'blue',    component: CollegeListSection },
  { id: 'scores',    label: 'Test Scores',       icon: BarChart3,   color: 'purple',  component: TestScoresSection },
  { id: 'recs',      label: 'Recommendations',  icon: Mail,        color: 'amber',   component: RecommendationsSection },
];

export function CollegePrepTab() {
  const [activeSection, setActiveSection] = useState('gpa');
  const ActiveComponent = sections.find(s => s.id === activeSection)?.component || GPACalculator;

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="p-5 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-blue-500/10 rounded-2xl border border-indigo-500/20">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/20 rounded-xl">
            <GraduationCap className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-bold text-lg">College Application Prep</h3>
            <p className="text-sm text-muted-foreground">Track GPA, extracurriculars, college list, test scores, and recommendations</p>
          </div>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-2 flex-wrap">
        {sections.map(s => {
          const Icon = s.icon;
          const isActive = activeSection === s.id;
          return (
            <motion.button
              key={s.id}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                isActive
                  ? `bg-${s.color}-500/20 text-${s.color}-400 border-${s.color}-500/30 shadow-sm`
                  : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:bg-muted/70'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {s.label}
            </motion.button>
          );
        })}
      </div>

      {/* Active section */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          <ActiveComponent />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
