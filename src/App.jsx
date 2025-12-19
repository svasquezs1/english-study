import React, { useEffect, useMemo, useRef, useState } from "react";

// ✅ Firebase (ojo: renombramos db -> firestore para evitar choque con tu estado db)
import { auth, db as firestore } from "./firebase";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  Volume2,
  Eye,
  EyeOff,
  Plus,
  Download,
  Upload,
  Trash2,
  CalendarDays,
  LogOut,
} from "lucide-react";

/**
 * English Study Planner (A1–C1)
 * - Niveles (A1, A2, B1, B2, C1)
 * - Cada nivel tiene días
 * - Cada día tiene: Palabras y Frases
 * - Guardado en Firestore por usuario (Google Login)
 * - Botón pronunciación (Web Speech API)
 * - Mostrar/ocultar significado en español
 * - Importar/Exportar JSON
 */

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function defaultDB() {
  const db = {};
  for (const lvl of LEVELS) {
    db[lvl] = { days: { "1": { words: [], phrases: [] } } };
  }
  return db;
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

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

function TopBar({ title, left, right }) {
  return (
    <div className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b">
      <div className="mx-auto max-w-5xl px-4 py-3">
        {/* Fila 1: izquierda + título */}
        <div className="flex items-center gap-2">
          <div className="shrink-0">{left}</div>

          <h1 className="min-w-0 flex-1 text-base sm:text-xl font-semibold tracking-tight leading-snug truncate">
            {title}
          </h1>

          {/* En desktop, si quieres, también podrías poner acciones aquí,
              pero nosotros las dejamos en la fila 2 */}
        </div>

        {/* Fila 2: acciones (en móvil con scroll horizontal) */}
        {right ? (
          <div className="mt-2">
            <div className="flex gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
              {/* esto evita que los botones se hagan chiquitos */}
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

function ItemCard({ item, onToggle, onSpeak, onDelete }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base sm:text-lg font-semibold leading-snug">
                {item.en}
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]"
                onClick={onSpeak}
                title="Escuchar pronunciación"
              >
                <Volume2 className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]"
                onClick={onToggle}
                title={item.showEs ? "Ocultar significado" : "Ver significado"}
              >
                {item.showEs ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>

            {item.showEs ? (
              <div className="mt-2 text-sm text-muted-foreground">{item.es}</div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground italic">
                (toca el ojo para ver el significado)
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]"
            onClick={onDelete}
            title="Eliminar"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddItemDialog({ type, onAdd }) {
  const [en, setEn] = useState("");
  const [es, setEs] = useState("");

  const reset = () => {
    setEn("");
    setEs("");
  };

  const submit = () => {
    if (!en.trim() || !es.trim()) return;
    onAdd({
      id: uid(),
      en: en.trim(),
      es: es.trim(),
      showEs: false,
      createdAt: new Date().toISOString(),
    });
    reset();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]">
          <Plus className="h-4 w-4 mr-2" /> Agregar {type === "words" ? "palabra" : "frase"}
        </Button>
      </DialogTrigger>

      <DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar {type === "words" ? "palabra" : "frase"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Inglés</div>
            {type === "words" ? (
              <Input
                value={en}
                onChange={(e) => setEn(e.target.value)}
                placeholder="Ej: curious"
              />
            ) : (
              <Textarea
                value={en}
                onChange={(e) => setEn(e.target.value)}
                placeholder="Escribe la frase en inglés"
              />
            )}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Español (significado)</div>
            <Textarea
              value={es}
              onChange={(e) => setEs(e.target.value)}
              placeholder="Escribe el significado en español"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!en.trim() || !es.trim()}
            className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <Button variant="secondary" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]">
          <Plus className="h-4 w-4 mr-2" /> Agregar día
        </Button>
      </DialogTrigger>

      <DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar día</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Ejemplo: 1, 2, 3... (puedes crear el día que necesites)
          </div>
          <Input
            value={day}
            onChange={(e) => setDay(e.target.value)}
            placeholder="Número de día"
            inputMode="numeric"
          />
          {day && existingDays.includes(String(Number(day))) ? (
            <div className="text-sm text-destructive">Ese día ya existe.</div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!day.trim()} className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]">
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportImport({ db, setDB }) {
  const fileRef = useRef(null);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "english-study-planner.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = async (file) => {
    try {
      const text = await file.text();
      const parsed = safeParse(text, null);
      if (!parsed || typeof parsed !== "object") throw new Error("invalid");

      for (const lvl of LEVELS) {
        if (!parsed[lvl]?.days) throw new Error("invalid");
      }

      setDB(parsed);
    } catch {
      alert("Archivo inválido. Debe ser un JSON exportado desde esta app.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={exportJSON}>
        <Download className="h-4 w-4 mr-2" /> Exportar
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJSON(f);
          e.target.value = "";
        }}
      />

      <Button
        variant="secondary"
        className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-4 w-4 mr-2" /> Importar
      </Button>
    </div>
  );
}

export default function EnglishStudyPlannerApp() {
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // ✅ Tus datos de estudio (esto ya NO es Firestore)
  const [db, setDB] = useState(defaultDB());

  // Navegación simple
  const [level, setLevel] = useState(null);
  const [day, setDay] = useState(null);

  // Cargar voces
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const handler = () => {};
    synth.addEventListener?.("voiceschanged", handler);
    synth.getVoices?.();
    return () => synth.removeEventListener?.("voiceschanged", handler);
  }, []);

  // ✅ Escuchar sesión
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoadingUser(false);
    });
    return () => unsub();
  }, []);

  // ✅ Leer datos desde Firestore al iniciar sesión
  useEffect(() => {
    if (!user) return;

    const ref = doc(firestore, "users", user.uid);

    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data()?.studyData;
        setDB(data && typeof data === "object" ? data : defaultDB());
      } else {
        const initial = defaultDB();
        setDoc(ref, { studyData: initial });
        setDB(initial);
      }
    });

    return () => unsub();
  }, [user]);

  // ✅ Guardar cambios en Firestore cuando db cambie
  useEffect(() => {
    if (!user) return;
    const ref = doc(firestore, "users", user.uid);
    setDoc(ref, { studyData: db }, { merge: true });
  }, [db, user]);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const daysForLevel = useMemo(() => {
    if (!level) return [];
    const daysObj = db?.[level]?.days || {};
    return Object.keys(daysObj)
      .sort((a, b) => Number(a) - Number(b))
      .map((d) => ({ key: d, ...daysObj[d] }));
  }, [db, level]);

  const currentDay = useMemo(() => {
    if (!level || !day) return null;
    return db?.[level]?.days?.[day] || null;
  }, [db, level, day]);

  const goHome = () => {
    setLevel(null);
    setDay(null);
  };
  const goLevel = (lvl) => {
    setLevel(lvl);
    setDay(null);
  };
  const goDay = (d) => setDay(d);

  const updateDay = (updater) => {
    if (!level || !day) return;
    setDB((prev) => {
      const next = structuredClone(prev);
      const lvl = next[level];
      if (!lvl.days[day]) lvl.days[day] = { words: [], phrases: [] };
      updater(lvl.days[day]);
      return next;
    });
  };

  const addDay = (dayKey) => {
    if (!level) return;
    setDB((prev) => {
      const next = structuredClone(prev);
      next[level].days[dayKey] = next[level].days[dayKey] || {
        words: [],
        phrases: [],
      };
      return next;
    });
  };

  const deleteDay = (dayKey) => {
    if (!level) return;
    setDB((prev) => {
      const next = structuredClone(prev);
      delete next[level].days[dayKey];
      if (Object.keys(next[level].days).length === 0) {
        next[level].days["1"] = { words: [], phrases: [] };
      }
      return next;
    });
    if (day === dayKey) setDay(null);
  };

  // 🔐 Pantalla de carga / login
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
              Para que tus palabras y frases se guarden y puedas verlas en otro PC.
            </div>
            <Button className="w-full rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={loginWithGoogle}>
              Iniciar sesión con Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // HOME
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
            <div className="flex items-center gap-2">
              <ExportImport db={db} setDB={setDB} />
              <Button variant="secondary" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={logout}>
                <LogOut className="h-4 w-4 sm:mr-2" /> Cerrar sesión
                <span className="hidden sm:inline">Cerrar sesión</span>
              </Button>
            </div>
          }
        />

        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {LEVELS.map((lvl) => {
              const dayCount = Object.keys(db?.[lvl]?.days || {}).length;
              const wordsCount = Object.values(db?.[lvl]?.days || {}).reduce(
                (acc, d) => acc + (d.words?.length || 0),
                0
              );
              const phrasesCount = Object.values(db?.[lvl]?.days || {}).reduce(
                (acc, d) => acc + (d.phrases?.length || 0),
                0
              );

              return (
                <Card
                  key={lvl}
                  className="rounded-2xl hover:shadow-sm transition cursor-pointer"
                  onClick={() => goLevel(lvl)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-xl font-semibold">{lvl}</div>
                      <Badge className="rounded-full" variant="secondary">
                        {dayCount} día{dayCount === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      Palabras:{" "}
                      <span className="font-medium text-foreground">{wordsCount}</span>{" "}
                      · Frases:{" "}
                      <span className="font-medium text-foreground">{phrasesCount}</span>
                    </div>
                    <div className="mt-4 text-sm">
                      Entra para ver tus días y estudiar con pronunciación.
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-6">
            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">
                  Tip: si no suena la pronunciación, sube el volumen y prueba tocando
                  primero cualquier botón.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // LEVEL
  if (level && !day) {
    const existingDays = Object.keys(db?.[level]?.days || {}).sort(
      (a, b) => Number(a) - Number(b)
    );

    return (
      <div className="min-h-screen bg-background">
        <TopBar
          title={`Nivel ${level}`}
          left={
            <Button variant="ghost" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={goHome}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Volver
            </Button>
          }
          right={
            <div className="flex items-center gap-2">
              <AddDayDialog existingDays={existingDays} onAddDay={addDay} />
              <ExportImport db={db} setDB={setDB} />
              <Button variant="secondary" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
              </Button>
            </div>
          }
        />

        <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full" variant="secondary">
              <CalendarDays className="h-4 w-4 mr-2" /> Días del nivel
            </Badge>
            <div className="text-sm text-muted-foreground">
              Selecciona un día para ver Palabras y Frases.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {daysForLevel.map((d) => {
              const w = d.words?.length || 0;
              const p = d.phrases?.length || 0;

              return (
                <Card
                  key={d.key}
                  className="rounded-2xl hover:shadow-sm transition cursor-pointer"
                  onClick={() => goDay(d.key)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">Día {d.key}</div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          Palabras:{" "}
                          <span className="font-medium text-foreground">{w}</span>{" "}
                          · Frases:{" "}
                          <span className="font-medium text-foreground">{p}</span>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDay(d.key);
                        }}
                        title="Eliminar día"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Separator />

          <EmptyState
            title="¿Cómo usarlo?"
            subtitle="Entra a un día → agrega palabras o frases → practica viendo el significado y escuchando la pronunciación. (Ahora se guarda en la nube por tu usuario)."
          />
        </div>
      </div>
    );
  }

  // DAY
  const words = currentDay?.words || [];
  const phrases = currentDay?.phrases || [];

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        title={`Nivel ${level} · Día ${day}`}
        left={
          <Button variant="ghost" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={() => setDay(null)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Días
          </Button>
        }
        right={
          <div className="flex items-center gap-2">
            <ExportImport db={db} setDB={setDB} />
            <Button variant="secondary" className="rounded-full shrink-0 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]" onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
        <Tabs defaultValue="words" className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="rounded-full">
              <TabsTrigger value="words" className="rounded-full">
                Palabras
              </TabsTrigger>
              <TabsTrigger value="phrases" className="rounded-full">
                Frases
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <TabsContent value="words" className="m-0">
                <AddItemDialog
                  type="words"
                  onAdd={(item) =>
                    updateDay((d) => {
                      d.words = [item, ...(d.words || [])];
                    })
                  }
                />
              </TabsContent>

              <TabsContent value="phrases" className="m-0">
                <AddItemDialog
                  type="phrases"
                  onAdd={(item) =>
                    updateDay((d) => {
                      d.phrases = [item, ...(d.phrases || [])];
                    })
                  }
                />
              </TabsContent>
            </div>
          </div>

          <TabsContent value="words" className="mt-4">
            {words.length === 0 ? (
              <EmptyState
                title="Aún no tienes palabras en este día"
                subtitle="Agrega palabras en inglés con su significado en español."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {words.map((it) => (
                  <ItemCard
                    key={it.id}
                    item={it}
                    onSpeak={() => speakEnglish(it.en)}
                    onToggle={() =>
                      updateDay((d) => {
                        d.words = (d.words || []).map((x) =>
                          x.id === it.id ? { ...x, showEs: !x.showEs } : x
                        );
                      })
                    }
                    onDelete={() =>
                      updateDay((d) => {
                        d.words = (d.words || []).filter((x) => x.id !== it.id);
                      })
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="phrases" className="mt-4">
            {phrases.length === 0 ? (
              <EmptyState
                title="Aún no tienes frases en este día"
                subtitle="Agrega frases completas para practicar pronunciación y significado."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {phrases.map((it) => (
                  <ItemCard
                    key={it.id}
                    item={it}
                    onSpeak={() => speakEnglish(it.en)}
                    onToggle={() =>
                      updateDay((d) => {
                        d.phrases = (d.phrases || []).map((x) =>
                          x.id === it.id ? { ...x, showEs: !x.showEs } : x
                        );
                      })
                    }
                    onDelete={() =>
                      updateDay((d) => {
                        d.phrases = (d.phrases || []).filter((x) => x.id !== it.id);
                      })
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Separator />

        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <div className="text-sm font-medium">Sugerencias rápidas</div>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>Usa frases cortas para A1–A2 y más largas para B2–C1.</li>
              <li>Primero intenta recordar el significado, luego abre el ojo para verificar.</li>
              <li>Si la voz suena en español, prueba usar un navegador con voces en inglés instaladas.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
