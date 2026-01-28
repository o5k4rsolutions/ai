import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, updateDoc, collection, 
  onSnapshot, query, where, addDoc 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { Timer, Users, Play, CheckCircle, Clock, AlertCircle, ChevronRight, BarChart3, Loader2, FileDown, GraduationCap } from 'lucide-react';

// --- CONFIGURATION ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyDfLJIcwoFTo-a2cPAcffnzQZeHoEtqKWk",
  authDomain: "generator-818f2.firebaseapp.com",
  projectId: "generator-818f2",
  storageBucket: "generator-818f2.firebasestorage.app",
  messagingSenderId: "530366296323",
  appId: "1:530366296323:web:59eb47073ef16c14653936"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : "generator-testow-v1";
const geminiApiKey = "AIzaSyBNG53QweHRbNDJhVss1Pag8kGELZobVio"; // Key is injected by environment

const glassStyle = "bg-white/90 backdrop-blur-md border border-slate-200 shadow-xl rounded-2xl p-6";

const loadJsPDF = () => {
  return new Promise((resolve, reject) => {
    if (window.jspdf) {
      resolve(window.jspdf);
      return;
    }
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf);
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('landing'); 
  const [testCode, setTestCode] = useState('');
  const [currentTest, setCurrentTest] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [error, setError] = useState(null);

  // RULE 3: Auth Before Queries
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { 
        console.error("Auth Error:", err); 
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Listeners Effect - Fixed Paths to follow RULE 1
  useEffect(() => {
    if (!user || !testCode) return;

    const testRef = doc(db, 'artifacts', appId, 'public', 'data', 'tests', testCode);
    const unsubTest = onSnapshot(testRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCurrentTest(data);
        if (view === 'student-lobby' && data.status === 'active') setView('student-quiz');
      }
    }, (err) => console.error("Test Snapshot Error:", err));

    const participantsRef = collection(db, 'artifacts', appId, 'public', 'data', 'tests', testCode, 'participants');
    const unsubParts = onSnapshot(participantsRef, (snap) => {
      setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Participants Snapshot Error:", err));

    const resultsRef = collection(db, 'artifacts', appId, 'public', 'data', 'tests', testCode, 'results');
    const unsubResults = onSnapshot(resultsRef, (snap) => {
      setResults(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Results Snapshot Error:", err));

    return () => { unsubTest(); unsubParts(); unsubResults(); };
  }, [user, testCode, view]);

  const fetchGemini = async (payload, retries = 5, delay = 1000) => {
    const apiKey = geminiApiKey || ""; 
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) return await response.json();
      } catch (e) {
        if (i === retries - 1) throw e;
      }
      await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
    }
  };

  const generateTest = async (config) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const systemPrompt = "Jesteś ekspertem edukacyjnym. Tworzysz testy w formacie JSON.";
    const userQuery = `Stwórz test o temacie "${config.topic}". Poziom: ${config.difficulty}. Liczba pytań: ${config.count}. Typ: ${config.type}. Zwróć TYLKO czysty JSON jako tablicę obiektów: [{"question": "treść", "options": ["A", "B", "C", "D"], "correct": 0, "type": "choice"}]`;

    try {
      const data = await fetchGemini({
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(data.candidates[0].content.parts[0].text);

      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tests', code), {
        code, 
        topic: config.topic, 
        questions: result, 
        duration: config.duration * 60, 
        status: 'lobby', 
        createdAt: new Date().toISOString(), 
        teacherId: user.uid
      });
      
      setTestCode(code);
      setView('teacher-lobby');
    } catch (err) {
      console.error(err);
      setError("Błąd generowania pytań.");
    } finally { setLoading(false); }
  };

  const joinTest = async () => {
    if (!studentName || !testCode || !user) return;
    const testRef = doc(db, 'artifacts', appId, 'public', 'data', 'tests', testCode);
    try {
      const snap = await getDoc(testRef);
      if (snap.exists()) {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tests', testCode, 'participants', user.uid), { 
          name: studentName, 
          joinedAt: new Date().toISOString() 
        });
        setView('student-lobby');
      } else {
        setError("Błędny kod sesji!");
      }
    } catch (e) {
      setError("Błąd podczas dołączania.");
    }
  };

  const generatePDF = async (userResult) => {
    try {
      const jspdfModule = await loadJsPDF();
      const jsPDF = jspdfModule.jsPDF || jspdfModule.jspdf.jsPDF;
      const pdf = new jsPDF();
      
      const calculateScore = (ur) => {
        let correctCount = 0;
        let totalCount = 0;
        currentTest.questions.forEach((q, i) => {
          if (q.type === 'choice') {
            totalCount++;
            if (ur.answers[i] === q.correct.toString()) correctCount++;
          }
        });
        const percent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
        return { correctCount, totalCount, percent };
      };

      const score = calculateScore(userResult);
      pdf.setFont("helvetica", "bold");
      pdf.text("Raport z Testu EduAI", 20, 30);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Temat: ${currentTest.topic}`, 20, 45);
      pdf.text(`Uczeń: ${userResult.name}`, 20, 55);
      pdf.text(`Wynik: ${score.percent}% (${score.correctCount}/${score.totalCount})`, 20, 65);
      pdf.save(`Wynik_${userResult.name}.pdf`);
    } catch (e) {
      console.error(e);
      setError("Błąd PDF.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">T</div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">EduAI Test</h1>
          </div>
          {error && <div className="text-red-500 text-sm flex items-center gap-2 bg-red-50 px-3 py-1 rounded-lg border border-red-100">{error}</div>}
        </header>

        {view === 'landing' && (
          <div className="grid md:grid-cols-2 gap-6">
            <button onClick={() => setView('teacher-setup')} className={`${glassStyle} text-left hover:scale-[1.01] transition-transform`}>
              <BarChart3 className="text-indigo-600 mb-4" size={32} />
              <h2 className="text-xl font-bold">Panel Nauczyciela</h2>
              <p className="text-slate-500">Stwórz nowy test i zarządzaj wynikami.</p>
            </button>
            <button onClick={() => setView('student-join')} className={`${glassStyle} text-left hover:scale-[1.01] transition-transform`}>
              <Users className="text-emerald-600 mb-4" size={32} />
              <h2 className="text-xl font-bold">Panel Ucznia</h2>
              <p className="text-slate-500">Dołącz do aktywnej sesji testowej.</p>
            </button>
          </div>
        )}

        {view === 'teacher-setup' && <TeacherSetup onGenerate={generateTest} loading={loading} />}
        
        {view === 'teacher-lobby' && (
          <div className={glassStyle}>
            <div className="flex flex-wrap justify-between items-end gap-4 mb-8">
              <div>
                <h2 className="text-3xl font-black">{currentTest?.topic}</h2>
                <div className="mt-4 flex gap-4">
                  <div className="bg-slate-900 text-white p-3 rounded-xl text-center">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Kod sesji</p>
                    <p className="text-2xl font-mono font-black">{testCode}</p>
                  </div>
                  <div className="p-3">
                    <p className="text-2xl font-bold">{participants.length}</p>
                    <p className="text-xs uppercase font-bold text-slate-400">Uczniów</p>
                  </div>
                </div>
              </div>
              <button 
                onClick={async () => await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tests', testCode), { status: 'active' })}
                disabled={participants.length === 0}
                className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 disabled:bg-slate-200"
              >
                <Play size={20} /> Start Testu
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {participants.map(p => (
                <div key={p.id} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-2 shadow-sm">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">{p.name?.[0]}</div>
                  <span className="truncate font-medium">{p.name}</span>
                </div>
              ))}
            </div>
            {results.length > 0 && (
              <button onClick={() => setView('teacher-results')} className="mt-8 text-indigo-600 font-bold flex items-center gap-2 hover:underline">
                <BarChart3 size={18} /> Zobacz wyniki ({results.length})
              </button>
            )}
          </div>
        )}

        {view === 'teacher-results' && <TeacherResults results={results} test={currentTest} generatePDF={generatePDF} />}

        {view === 'student-join' && (
          <div className={`${glassStyle} max-w-md mx-auto`}>
            <h2 className="text-2xl font-bold mb-6 text-center">Dołącz do gry</h2>
            <input type="text" placeholder="Twoje imię" value={studentName} onChange={e => setStudentName(e.target.value)} className="w-full p-4 mb-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none" />
            <input type="text" placeholder="Kod sesji" value={testCode} onChange={e => setTestCode(e.target.value.toUpperCase())} className="w-full p-4 mb-6 rounded-xl border border-slate-200 text-center font-mono text-2xl tracking-widest focus:ring-2 focus:ring-emerald-500 outline-none" maxLength={6} />
            <button onClick={joinTest} disabled={!studentName || testCode.length < 6} className="w-full bg-emerald-600 text-white p-4 rounded-xl font-bold text-lg hover:bg-emerald-700 disabled:bg-slate-200">Dołącz</button>
          </div>
        )}

        {view === 'student-lobby' && (
          <div className={`${glassStyle} text-center py-16`}>
            <Loader2 className="animate-spin mx-auto text-emerald-600 mb-6" size={48} />
            <h2 className="text-3xl font-black mb-2">Cześć, {studentName}!</h2>
            <p className="text-slate-500">Czekamy na sygnał od nauczyciela, aby rozpocząć test.</p>
          </div>
        )}

        {view === 'student-quiz' && currentTest && (
          <StudentQuiz test={currentTest} onSubmit={async (ans, timing) => {
            if (!user) return;
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tests', testCode, 'results', user.uid), { 
              name: studentName, 
              answers: ans, 
              timing, 
              submittedAt: new Date().toISOString() 
            });
            setView('landing'); 
            setTestCode(''); 
            setStudentName(''); 
          }} />
        )}
      </div>
    </div>
  );
}

function TeacherSetup({ onGenerate, loading }) {
  const [cfg, setCfg] = useState({ topic: '', difficulty: 'średni', count: 5, duration: 10, type: 'choice' });
  return (
    <div className={glassStyle}>
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><Clock /> Skonfiguruj Test</h2>
      <div className="space-y-6">
        <textarea placeholder="Temat (np. Budowa komórki roślinnej)" value={cfg.topic} onChange={e => setCfg({...cfg, topic: e.target.value})} className="w-full p-4 rounded-xl border border-slate-200 min-h-[100px] outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="grid md:grid-cols-3 gap-4">
          <div><label className="text-xs font-bold text-slate-400 uppercase">Liczba pytań</label><input type="number" value={cfg.count} onChange={e => setCfg({...cfg, count: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
          <div><label className="text-xs font-bold text-slate-400 uppercase">Czas (min)</label><input type="number" value={cfg.duration} onChange={e => setCfg({...cfg, duration: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
          <div><label className="text-xs font-bold text-slate-400 uppercase">Trudność</label>
            <select value={cfg.difficulty} onChange={e => setCfg({...cfg, difficulty: e.target.value})} className="w-full p-3 border rounded-lg">
              <option>łatwy</option><option>średni</option><option>trudny</option>
            </select>
          </div>
        </div>
        <button onClick={() => onGenerate(cfg)} disabled={loading || !cfg.topic} className="w-full bg-slate-900 text-white p-5 rounded-2xl font-bold text-lg flex justify-center items-center gap-2">
          {loading ? <Loader2 className="animate-spin" /> : <><Play fill="white" size={18} /> Generuj AI</>}
        </button>
      </div>
    </div>
  );
}

function TeacherResults({ results, test, generatePDF }) {
  const [selected, setSelected] = useState(null);

  const calculateScore = (userResults) => {
    let correctCount = 0;
    let totalCount = 0;
    test.questions.forEach((q, i) => {
      if (q.type === 'choice') {
        totalCount++;
        if (userResults.answers[i] === q.correct.toString()) correctCount++;
      }
    });
    const percent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
    return { correctCount, totalCount, percent };
  };

  return (
    <div className="space-y-6">
      <div className={glassStyle}>
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><BarChart3 /> Tabela Wyników</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b text-slate-400 text-xs uppercase"><th className="pb-3">Uczeń</th><th className="pb-3">Wynik</th><th className="pb-3">Czas</th><th className="pb-3 text-right">Akcje</th></tr></thead>
            <tbody className="divide-y">
              {results.map(r => {
                const score = calculateScore(r);
                return (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 font-bold">{r.name}</td>
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${score.percent > 50 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {score.percent}%
                      </span>
                    </td>
                    <td className="py-4 text-slate-500">{r.timing.total}s</td>
                    <td className="py-4 text-right flex gap-2 justify-end">
                      <button onClick={() => setSelected(r)} className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg"><CheckCircle size={18} /></button>
                      <button onClick={() => generatePDF(r)} className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg"><FileDown size={18} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className={glassStyle}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold">Analiza: {selected.name}</h3>
            <button onClick={() => setSelected(null)} className="p-2 hover:bg-slate-100 rounded-lg">✕</button>
          </div>
          <div className="space-y-6">
            {test.questions.map((q, i) => {
              const isCorrect = q.type === 'choice' && selected.answers[i] === q.correct.toString();
              return (
                <div key={i} className={`p-4 rounded-xl border-l-4 ${isCorrect ? 'border-emerald-500 bg-emerald-50/30' : 'border-red-500 bg-red-50/30'}`}>
                  <p className="font-bold mb-2">{i+1}. {q.question}</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400 uppercase text-[10px] font-bold">Uczeń wybrał:</p>
                      <p className={isCorrect ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                        {q.type === 'choice' ? q.options[selected.answers[i]] || 'Brak' : selected.answers[i]}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 uppercase text-[10px] font-bold">Poprawna odpowiedź:</p>
                      <p className="text-emerald-700 font-bold">
                        {q.type === 'choice' ? q.options[q.correct] : q.correct}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StudentQuiz({ test, onSubmit }) {
  const [idx, setIdx] = useState(0);
  const [ans, setAns] = useState([]);
  const [curr, setCurr] = useState('');
  const [timer, setTimer] = useState(test.duration);
  const [startTime] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setTimer(p => {
        if (p <= 1) {
          clearInterval(t);
          onSubmit([...ans, curr], { total: Math.round((Date.now() - startTime) / 1000) });
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [idx, ans, curr]);

  const next = () => {
    const newAns = [...ans, curr];
    if (idx < test.questions.length - 1) {
      setAns(newAns); 
      setIdx(idx + 1); 
      setCurr('');
    } else {
      onSubmit(newAns, { total: Math.round((Date.now() - startTime) / 1000) });
    }
  };

  const q = test.questions[idx];
  return (
    <div className="max-w-2xl mx-auto pt-10">
      <div className="flex justify-between items-center mb-6">
        <div className="bg-white px-4 py-2 rounded-xl border font-mono font-bold flex items-center gap-2">
          <Clock size={16} /> {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
        </div>
        <div className="bg-white px-4 py-2 rounded-xl border font-bold">
          Pytanie {idx+1}/{test.questions.length}
        </div>
      </div>
      <div className={glassStyle}>
        <div className="mb-8">
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${((idx + 1) / test.questions.length) * 100}%` }}></div>
          </div>
          <h3 className="text-2xl font-bold">{q.question}</h3>
        </div>

        {q.type === 'choice' ? (
          <div className="space-y-3">
            {q.options.map((o, i) => (
              <button 
                key={i} 
                onClick={() => setCurr(i.toString())} 
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${curr === i.toString() ? 'border-indigo-600 bg-indigo-50' : 'border-slate-100 hover:border-slate-200'}`}
              >
                <span className="font-bold mr-3">{String.fromCharCode(65+i)}.</span> {o}
              </button>
            ))}
          </div>
        ) : (
          <textarea 
            value={curr} 
            onChange={e => setCurr(e.target.value)} 
            className="w-full p-4 border-2 rounded-xl h-32 outline-none focus:border-indigo-500" 
            placeholder="Twoja odpowiedź..." 
          />
        )}
        <button 
          onClick={next} 
          disabled={curr === ''} 
          className="w-full mt-8 bg-slate-900 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-50 transition-opacity"
        >
          {idx < test.questions.length - 1 ? 'Następne pytanie' : 'Zakończ test'} <ChevronRight />
        </button>
      </div>
    </div>
  );
}
