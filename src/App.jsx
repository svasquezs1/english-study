import React, { useEffect, useMemo, useRef, useState } from "react";

import { Moon, Sun } from "lucide-react";

// Firebase
import { auth, db as firestore } from "./firebase";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

import {
  collection,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  getDocs,
  writeBatch,
} from "firebase/firestore";

// UI (shadcn)
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  ChevronLeft,
  Volume2,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  CalendarDays,
  LogOut,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
} from "lucide-react";

/**
 * NUEVA ESTRUCTURA (Firestore)
 * users/{uid}/levels/{level}/days/{dayId}
 * users/{uid}/levels/{level}/days/{dayId}/words/{wordId}
 * users/{uid}/levels/{level}/days/{dayId}/words/{wordId}/phrases/{phraseId}
 *
 * Reglas:
 * - Máx 40 palabras por día
 * - Máx 10 frases por palabra
 */

const THEME_KEY = "english_study_theme";

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

function speakEnglish(text) {
  if (!text?.trim()) return;
  const synth = window.speechSynthesis;
  if (!synth) {
    alert("Tu navegador no soporta Speech Synthesis (TTS). Prueba con Chrome/Edge.");
    return;
  }
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);

  const voices = synth.getVoices?.() || [];
  const englishVoice =
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("en")) || null;

  if (englishVoice) utter.voice = englishVoice;
  utter.lang = englishVoice?.lang || "en-US";
  utter.rate = 1;
  utter.pitch = 1;

  synth.speak(utter);
}

// Firestore path helpers
const levelDaysCol = (uid, level) =>
  collection(firestore, "users", uid, "levels", level, "days");

const dayDocRef = (uid, level, dayId) =>
  doc(firestore, "users", uid, "levels", level, "days", dayId);

const wordsCol = (uid, level, dayId) =>
  collection(firestore, "users", uid, "levels", level, "days", dayId, "words");

const wordDocRef = (uid, level, dayId, wordId) =>
  doc(firestore, "users", uid, "levels", level, "days", dayId, "words", wordId);

const phrasesCol = (uid, level, dayId, wordId) =>
  collection(
    firestore,
    "users",
    uid,
    "levels",
    level,
    "days",
    dayId,
    "words",
    wordId,
    "phrases"
  );

const phraseDocRef = (uid, level, dayId, wordId, phraseId) =>
  doc(
    firestore,
    "users",
    uid,
    "levels",
    level,
    "days",
    dayId,
    "words",
    wordId,
    "phrases",
    phraseId
  );

function TopBar({ title, left, right }) {
  // Barra robusta: título arriba, acciones abajo con scroll en móvil
  return (
    <div className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="shrink-0">{left}</div>

          <h1 className="min-w-0 flex-1 text-base sm:text-xl font-semibold tracking-tight leading-snug truncate">
            {title}
          </h1>
        </div>

        {right ? (
          <div className="mt-2">
            <div className="flex gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
              <div className="flex gap-2 min-w-max">{right}</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ title, subtitle, action }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-6">
        <div className="text-center space-y-2">
          <div className="text-base font-semibold">{title}</div>
          <div className="text-sm text-muted-foreground">{subtitle}</div>
          {action ? <div className="pt-2">{action}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FxButton({ className = "", ...props }) {
  return (
    <Button
      {...props}
      className={`transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98] ${className}`}
    />
  );
}

function AddDayDialog({ existingDays, onAddDay }) {
  const [day, setDay] = useState("");

  const submit = () => {
    const n = Number(day);
    if (!Number.isFinite(n) || n <= 0) return;
    const key = String(Math.trunc(n));
    if (existingDays.includes(key)) return;
    onAddDay(key);
    setDay("");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <FxButton variant="secondary" className="rounded-full shrink-0">
          <Plus className="h-4 w-4 mr-2" /> Agregar día
        </FxButton>
      </DialogTrigger>

      <DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar día</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Ejemplo: 1, 2, 3... (días numéricos)
          </div>
          <Input
            value={day}
            onChange={(e) => setDay(e.target.value)}
            placeholder="Número de día"
            inputMode="numeric"
          />
          {day && existingDays.includes(String(Math.trunc(Number(day)))) ? (
            <div className="text-sm text-destructive">Ese día ya existe.</div>
          ) : null}
        </div>

        <DialogFooter>
          <FxButton onClick={submit} disabled={!day.trim()} className="rounded-full">
            Crear
          </FxButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddWordDialog({ onAddWord, disabled }) {
  const [en, setEn] = useState("");
  const [es, setEs] = useState("");

  const submit = async () => {
    if (!en.trim() || !es.trim()) return;
    await onAddWord({ en: en.trim(), es: es.trim() });
    setEn("");
    setEs("");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <FxButton className="rounded-full shrink-0" disabled={disabled}>
          <Plus className="h-4 w-4 mr-2" /> Agregar palabra
        </FxButton>
      </DialogTrigger>

      <DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar palabra</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Inglés</div>
            <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="Ej: curious" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">Español (traducción)</div>
            <Textarea
              value={es}
              onChange={(e) => setEs(e.target.value)}
              placeholder="Ej: curioso"
            />
          </div>
        </div>

        <DialogFooter>
          <FxButton
            onClick={submit}
            disabled={!en.trim() || !es.trim()}
            className="rounded-full"
          >
            Guardar
          </FxButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPhraseDialog({ onAddPhrase, disabled }) {
  const [en, setEn] = useState("");
  const [es, setEs] = useState("");

  const submit = async () => {
    if (!en.trim() || !es.trim()) return;
    await onAddPhrase({ en: en.trim(), es: es.trim() });
    setEn("");
    setEs("");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <FxButton variant="secondary" className="rounded-full shrink-0" disabled={disabled}>
          <Plus className="h-4 w-4 mr-2" /> Agregar frase
        </FxButton>
      </DialogTrigger>

      <DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar frase</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Inglés</div>
            <Textarea
              value={en}
              onChange={(e) => setEn(e.target.value)}
              placeholder="Escribe la frase en inglés"
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">Español (traducción)</div>
            <Textarea
              value={es}
              onChange={(e) => setEs(e.target.value)}
              placeholder="Escribe la traducción"
            />
          </div>
        </div>

        <DialogFooter>
          <FxButton
            onClick={submit}
            disabled={!en.trim() || !es.trim()}
            className="rounded-full"
          >
            Guardar
          </FxButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export / Import (opcional pero útil)
function ExportImportCloud({ user }) {
  const fileRef = useRef(null);

  const exportAll = async () => {
    const out = { levels: {} };

    for (const level of LEVELS) {
      out.levels[level] = { days: {} };

      const daysSnap = await getDocs(query(levelDaysCol(user.uid, level), orderBy("dayNumber", "asc")));
      for (const dayDoc of daysSnap.docs) {
        const dayId = dayDoc.id;
        out.levels[level].days[dayId] = { words: {} };

        const wSnap = await getDocs(query(wordsCol(user.uid, level, dayId), orderBy("createdAt", "asc")));
        for (const w of wSnap.docs) {
          out.levels[level].days[dayId].words[w.id] = {
            ...w.data(),
            phrases: {},
          };

          const pSnap = await getDocs(query(phrasesCol(user.uid, level, dayId, w.id), orderBy("createdAt", "asc")));
          for (const p of pSnap.docs) {
            out.levels[level].days[dayId].words[w.id].phrases[p.id] = p.data();
          }
        }
      }
    }

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "english-study-cloud-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAll = async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed?.levels) throw new Error("invalid");

      const batch = writeBatch(firestore);

      // Importa sin borrar lo existente: crea/merge docs
      for (const level of LEVELS) {
        const lvl = parsed.levels?.[level];
        if (!lvl?.days) continue;

        for (const [dayId, dayObj] of Object.entries(lvl.days)) {
          const dayN = Number(dayId);
          batch.set(
            dayDocRef(user.uid, level, dayId),
            { dayNumber: Number.isFinite(dayN) ? dayN : 0, createdAt: serverTimestamp() },
            { merge: true }
          );

          const wordsObj = dayObj?.words || {};
          for (const [wordId, wordData] of Object.entries(wordsObj)) {
            batch.set(
              wordDocRef(user.uid, level, dayId, wordId),
              {
                en: wordData.en ?? "",
                es: wordData.es ?? "",
                createdAt: serverTimestamp(),
              },
              { merge: true }
            );

            const phrasesObj = wordData?.phrases || {};
            for (const [phraseId, phraseData] of Object.entries(phrasesObj)) {
              batch.set(
                phraseDocRef(user.uid, level, dayId, wordId, phraseId),
                {
                  en: phraseData.en ?? "",
                  es: phraseData.es ?? "",
                  createdAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          }
        }
      }

      await batch.commit();
      alert("Importación completada (se mezcló con lo existente).");
    } catch {
      alert("Import inválido. Debe ser un JSON exportado por esta app.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <FxButton variant="secondary" className="rounded-full shrink-0" onClick={exportAll}>
        <Download className="h-4 w-4 mr-2" /> Exportar
      </FxButton>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importAll(f);
          e.target.value = "";
        }}
      />

      <FxButton
        variant="secondary"
        className="rounded-full shrink-0"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-4 w-4 mr-2" /> Importar
      </FxButton>
    </div>
  );
}

export default function EnglishStudyPlannerApp() {
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Navegación
  const [level, setLevel] = useState(null);
  const [day, setDay] = useState(null);

  // Datos actuales (en pantalla)
  const [days, setDays] = useState([]); // [{id, dayNumber}]
  const [words, setWords] = useState([]); // [{id, en, es, showEs}]
  const [phrasesByWord, setPhrasesByWord] = useState({}); // wordId -> [{id,en,es,showEs}]
  const [expandedWords, setExpandedWords] = useState({}); // wordId -> bool
  const phrasesUnsubsRef = useRef({}); // wordId -> unsub function

  const [theme, setTheme] = useState("light");

  const resetDayUI = () => {
    // detener listeners de frases si existen
    Object.values(phrasesUnsubsRef.current).forEach((fn) => {
      try { fn?.(); } catch {}
    });
    phrasesUnsubsRef.current = {};

    // limpiar UI
    setWords([]);
    setPhrasesByWord({});
    setExpandedWords({});
  };

  useEffect(() => {
    const t = getInitialTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
      return next;
    });
  };


  // Cargar voces
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const handler = () => {};
    synth.addEventListener?.("voiceschanged", handler);
    synth.getVoices?.();
    return () => synth.removeEventListener?.("voiceschanged", handler);
  }, []);

  // Sesión
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoadingUser(false);
    });
    return () => unsub();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    // limpiar listeners
    Object.values(phrasesUnsubsRef.current).forEach((fn) => {
      try { fn?.(); } catch {}
    });
    phrasesUnsubsRef.current = {};
    setPhrasesByWord({});
    setExpandedWords({});
    setWords([]);
    setDays([]);
    setLevel(null);
    setDay(null);

    await signOut(auth);
  };

  // Escuchar días cuando estamos dentro de un nivel
  useEffect(() => {
    if (!user || !level || day) return;

    const q = query(levelDaysCol(user.uid, level), orderBy("dayNumber", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Si no hay días, crea el día 1 automáticamente
      if (next.length === 0) {
        setDoc(dayDocRef(user.uid, level, "1"), { dayNumber: 1, createdAt: serverTimestamp() }, { merge: true });
      }
      setDays(next);
    });

    return () => unsub();
  }, [user, level, day]);

  // Escuchar palabras cuando estamos dentro de un día
  useEffect(() => {
    if (!user || !level || !day) return;

    // ✅ LIMPIAR UI INMEDIATAMENTE al cambiar de día
    setWords([]);
    setPhrasesByWord({});
    setExpandedWords({});

    // ✅ limpiar listeners previos de frases
    Object.values(phrasesUnsubsRef.current).forEach((fn) => {
      try { fn?.(); } catch {}
    });
    phrasesUnsubsRef.current = {};

    // ✅ asegurar doc del día
    const dayN = Number(day);
    setDoc(
      dayDocRef(user.uid, level, day),
      { dayNumber: Number.isFinite(dayN) ? dayN : 0, createdAt: serverTimestamp() },
      { merge: true }
    );

    const q = query(wordsCol(user.uid, level, day), orderBy("createdAt", "asc"), limit(40));

    // ✅ agrega callback de error para detectar permisos/reglas
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          showEs: false,
        }));
        setWords(next); // si está vacío, deja []
      },
      (err) => {
        console.error("Error leyendo palabras del día:", err);
        // si falla, al menos no dejes datos viejos en pantalla
        setWords([]);
      }
    );

    return () => unsub();
  }, [user, level, day]);


  // Helpers CRUD
  const addDay = async (dayId) => {
    const n = Number(dayId);
    await setDoc(
      dayDocRef(user.uid, level, dayId),
      { dayNumber: Number.isFinite(n) ? n : 0, createdAt: serverTimestamp() },
      { merge: true }
    );
  };

  const deleteDay = async (dayId) => {
    // Borra el día (NO borra subcolecciones automáticamente)
    // Para una app personal pequeña está bien; si quieres borrar completo (palabras/frases) lo hacemos luego.
    await deleteDoc(dayDocRef(user.uid, level, dayId));
    if (day === dayId) setDay(null);
  };

  const addWord = async ({ en, es }) => {
    if (words.length >= 40) {
      alert("Máximo 40 palabras por día.");
      return;
    }
    await addDoc(wordsCol(user.uid, level, day), {
      en,
      es,
      createdAt: serverTimestamp(),
    });
  };

  const deleteWord = async (wordId) => {
    // Detener listener de frases si estaba abierto
    try {
      phrasesUnsubsRef.current[wordId]?.();
    } catch {}
    delete phrasesUnsubsRef.current[wordId];

    setExpandedWords((p) => {
      const n = { ...p };
      delete n[wordId];
      return n;
    });
    setPhrasesByWord((p) => {
      const n = { ...p };
      delete n[wordId];
      return n;
    });

    await deleteDoc(wordDocRef(user.uid, level, day, wordId));
  };

  const toggleWordEs = (wordId) => {
    setWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, showEs: !w.showEs } : w))
    );
  };

  const ensurePhrasesListener = (wordId) => {
    if (phrasesUnsubsRef.current[wordId]) return;

    const q = query(
      phrasesCol(user.uid, level, day, wordId),
      orderBy("createdAt", "asc"),
      limit(10)
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        showEs: false,
      }));
      setPhrasesByWord((prev) => ({ ...prev, [wordId]: next }));
    });

    phrasesUnsubsRef.current[wordId] = unsub;
  };

  const toggleExpand = (wordId) => {
    setExpandedWords((prev) => {
      const next = { ...prev, [wordId]: !prev[wordId] };
      return next;
    });

    // Lazy-load: cuando expandes por primera vez, se suscribe
    ensurePhrasesListener(wordId);
  };

  const addPhrase = async (wordId, { en, es }) => {
    const current = phrasesByWord[wordId]?.length || 0;
    if (current >= 10) {
      alert("Máximo 10 frases por palabra.");
      return;
    }
    await addDoc(phrasesCol(user.uid, level, day, wordId), {
      en,
      es,
      createdAt: serverTimestamp(),
    });
  };

  const deletePhrase = async (wordId, phraseId) => {
    await deleteDoc(phraseDocRef(user.uid, level, day, wordId, phraseId));
  };

  const togglePhraseEs = (wordId, phraseId) => {
    setPhrasesByWord((prev) => {
      const list = prev[wordId] || [];
      return {
        ...prev,
        [wordId]: list.map((p) => (p.id === phraseId ? { ...p, showEs: !p.showEs } : p)),
      };
    });
  };

  // Render login
  if (loadingUser) {
    return <div className="p-10">Cargando usuario...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="rounded-2xl w-full max-w-md">
          <CardContent className="p-6 space-y-4">
            <div className="text-xl font-semibold">Inicia sesión</div>
            <div className="text-sm text-muted-foreground">
              Para que tu contenido se guarde en la nube y lo veas en cualquier PC.
            </div>
            <FxButton className="w-full rounded-full" onClick={loginWithGoogle}>
              Iniciar sesión con Google
            </FxButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  // HOME (niveles)
  if (!level) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar
          title="Inglés por niveles (A1–C1)"
          left={
            <Badge className="rounded-full" variant="secondary">
              Estudio diario
            </Badge>
          }
          right={
            <>
              <FxButton
                variant="secondary"
                className="rounded-full shrink-0"
                onClick={toggleTheme}
                title="Cambiar tema"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="hidden sm:inline ml-2">
                  {theme === "dark" ? "Claro" : "Oscuro"}
                </span>
              </FxButton>

              <ExportImportCloud user={user} />
              <FxButton variant="secondary" className="rounded-full shrink-0" onClick={logout}>
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Cerrar sesión</span>
              </FxButton>
            </>
          }
        />

        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {LEVELS.map((lvl) => (
              <Card
                key={lvl}
                className="rounded-2xl hover:shadow-sm transition-all duration-200 hover:-translate-y-[1px] active:translate-y-0 cursor-pointer"
                onClick={() => {
                  setLevel(lvl);
                  setDay(null);
                }}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-xl font-semibold">{lvl}</div>
                    <Badge className="rounded-full" variant="secondary">
                      Nivel
                    </Badge>
                  </div>
                  <div className="mt-4 text-sm text-muted-foreground">
                    Entra para ver tus días. Cada día: máx 40 palabras, cada palabra: máx 10 frases.
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // LEVEL (lista de días)
  if (level && !day) {
    const existingDays = days.map((d) => d.id).sort((a, b) => Number(a) - Number(b));

    return (
      <div className="min-h-screen bg-background">
        <TopBar
          title={`Nivel ${level}`}
          left={
            <FxButton variant="ghost" className="rounded-full" onClick={() => setLevel(null)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Volver
            </FxButton>
          }
          right={
            <>
              <FxButton
                variant="secondary"
                className="rounded-full shrink-0"
                onClick={toggleTheme}
                title="Cambiar tema"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="hidden sm:inline ml-2">
                  {theme === "dark" ? "Claro" : "Oscuro"}
                </span>
              </FxButton>

              <AddDayDialog existingDays={existingDays} onAddDay={addDay} />
              <ExportImportCloud user={user} />
              <FxButton variant="secondary" className="rounded-full shrink-0" onClick={logout}>
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Cerrar sesión</span>
              </FxButton>
            </>
          }
        />

        <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full" variant="secondary">
              <CalendarDays className="h-4 w-4 mr-2" /> Días del nivel
            </Badge>
            <div className="text-sm text-muted-foreground">
              Selecciona un día para ver palabras y frases.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {days.map((d) => (
              <Card
                key={d.id}
                className="rounded-2xl hover:shadow-sm transition-all duration-200 hover:-translate-y-[1px] active:translate-y-0 cursor-pointer"
                onClick={() => setDay(d.id)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">Día {d.id}</div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        Máx 40 palabras · Máx 10 frases por palabra
                      </div>
                    </div>

                    <FxButton
                      variant="ghost"
                      size="icon"
                      className="rounded-full transition-transform active:scale-95"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDay(d.id);
                      }}
                      title="Eliminar día"
                    >
                      <Trash2 className="h-4 w-4" />
                    </FxButton>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Separator />

          <EmptyState
            title="Tip"
            subtitle="Entra a un día → agrega palabras → abre cada palabra para agregar hasta 10 frases."
          />
        </div>
      </div>
    );
  }

  // DAY (palabras con frases expandibles)
  const wordsCount = words.length;

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        title={`Nivel ${level} · Día ${day}`}
        left={
          <FxButton
            variant="ghost"
            className="rounded-full"
            onClick={() => {
              resetDayUI();
              setDay(null);
            }}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Días
          </FxButton>
        }

        right={
          <>
            <FxButton
              variant="secondary"
              className="rounded-full shrink-0"
              onClick={toggleTheme}
              title="Cambiar tema"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline ml-2">
                {theme === "dark" ? "Claro" : "Oscuro"}
              </span>
            </FxButton>

            <Badge className="rounded-full shrink-0" variant="secondary">
              {wordsCount}/40 palabras
            </Badge>

            <AddWordDialog onAddWord={addWord} disabled={wordsCount >= 40} />

            <ExportImportCloud user={user} />

            <FxButton variant="secondary" className="rounded-full shrink-0" onClick={logout}>
              <LogOut className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </FxButton>
          </>
        }
      />

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
        {words.length === 0 ? (
          <EmptyState
            title="Aún no tienes palabras en este día"
            subtitle="Agrega hasta 40 palabras, y en cada palabra agrega hasta 10 frases."
          />
        ) : (
          <div className="space-y-3">
            {words.map((w, idx) => {
              const expanded = !!expandedWords[w.id];
              const phrases = phrasesByWord[w.id] || [];
              const phrasesCount = phrases.length;

              return (
                <Card key={w.id} className="rounded-2xl">
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    {/* Header palabra */}
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base sm:text-lg font-semibold leading-snug">
                            {idx + 1}. {w.en}
                          </div>

                          <FxButton
                            variant="ghost"
                            size="icon"
                            className="rounded-full transition-transform active:scale-95"
                            onClick={() => speakEnglish(w.en)}
                            title="Escuchar pronunciación"
                          >
                            <Volume2 className="h-4 w-4" />
                          </FxButton>

                          <FxButton
                            variant="ghost"
                            size="icon"
                            className="rounded-full transition-transform active:scale-95"
                            onClick={() => toggleWordEs(w.id)}
                            title={w.showEs ? "Ocultar traducción" : "Ver traducción"}
                          >
                            {w.showEs ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </FxButton>

                          <Badge className="rounded-full" variant="secondary">
                            {phrasesCount}/10 frases
                          </Badge>
                        </div>

                        {w.showEs ? (
                          <div className="mt-2 text-sm text-muted-foreground">{w.es}</div>
                        ) : (
                          <div className="mt-2 text-sm text-muted-foreground italic">
                            (toca el ojo para ver la traducción)
                          </div>
                        )}
                      </div>

                      <FxButton
                        variant="ghost"
                        size="icon"
                        className="rounded-full transition-transform active:scale-95"
                        onClick={() => deleteWord(w.id)}
                        title="Eliminar palabra"
                      >
                        <Trash2 className="h-4 w-4" />
                      </FxButton>
                    </div>

                    {/* Acciones palabra */}
                    <div className="flex flex-wrap items-center gap-2">
                      <FxButton
                        variant="secondary"
                        className="rounded-full shrink-0"
                        onClick={() => toggleExpand(w.id)}
                      >
                        {expanded ? (
                          <>
                            <ChevronUp className="h-4 w-4 mr-2" /> Cerrar frases
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-2" /> Ver frases
                          </>
                        )}
                      </FxButton>

                      <AddPhraseDialog
                        disabled={phrasesCount >= 10}
                        onAddPhrase={(data) => addPhrase(w.id, data)}
                      />
                    </div>

                    {/* Frases expandibles */}
                    {expanded ? (
                      <div className="pt-2 space-y-2">
                        {phrasesCount === 0 ? (
                          <div className="text-sm text-muted-foreground italic">
                            Aún no hay frases para esta palabra.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {phrases.map((p, i) => (
                              <Card key={p.id} className="rounded-2xl">
                                <CardContent className="p-3">
                                  <div className="flex items-start gap-3">
                                    <div className="flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="font-medium">
                                          {i + 1}. {p.en}
                                        </div>

                                        <FxButton
                                          variant="ghost"
                                          size="icon"
                                          className="rounded-full transition-transform active:scale-95"
                                          onClick={() => speakEnglish(p.en)}
                                          title="Escuchar pronunciación"
                                        >
                                          <Volume2 className="h-4 w-4" />
                                        </FxButton>

                                        <FxButton
                                          variant="ghost"
                                          size="icon"
                                          className="rounded-full transition-transform active:scale-95"
                                          onClick={() => togglePhraseEs(w.id, p.id)}
                                          title={p.showEs ? "Ocultar traducción" : "Ver traducción"}
                                        >
                                          {p.showEs ? (
                                            <EyeOff className="h-4 w-4" />
                                          ) : (
                                            <Eye className="h-4 w-4" />
                                          )}
                                        </FxButton>
                                      </div>

                                      {p.showEs ? (
                                        <div className="mt-1 text-sm text-muted-foreground">{p.es}</div>
                                      ) : (
                                        <div className="mt-1 text-sm text-muted-foreground italic">
                                          (toca el ojo para ver la traducción)
                                        </div>
                                      )}
                                    </div>

                                    <FxButton
                                      variant="ghost"
                                      size="icon"
                                      className="rounded-full transition-transform active:scale-95"
                                      onClick={() => deletePhrase(w.id, p.id)}
                                      title="Eliminar frase"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </FxButton>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Separator />

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <div className="text-sm font-medium">Sugerencias rápidas</div>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>Elige 10–20 palabras al día para que sea sostenible.</li>
              <li>En cada palabra escribe 3–10 frases con contextos distintos.</li>
              <li>Primero intenta recordar la traducción, luego la revelas.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
