import { useEffect, useRef, useState } from "react";
import { db } from "./firebase";
import {
  doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch,
  query, orderBy, where, addDoc,
} from "firebase/firestore";

const HALL_NAME = "صالة الدبزة";
const STATIONS = ["PS1", "PS2", "PS3", "PS4", "PS5"];

const GLYPHS = ["✕", "○", "△", "□"];

const PRESETS = [
  { m: 15, label: "15 دقيقة" },
  { m: 30, label: "30 دقيقة" },
  { m: 60, label: "ساعة" },
];

const EXPENSE_CATS = ["مشروبات", "ماكلة", "صيانة", "كهرباء", "كراء", "أخرى"];

const priceOf = (min) => Math.floor((min * 2.5) / 5 + 1e-9) * 5;

const clock = (ms) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const hms = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${h ? p(h) + ":" : ""}${p(m)}:${p(s)}`;
};

async function finishSession(id, d) {
  if (!d || d.status !== "running") return;
  const end = d.endsAt ? Math.min(Date.now(), d.endsAt) : Date.now();
  const exact = (end - d.startAt) / 60000;
  const session = {
    station: id,
    mode: d.endsAt ? "timer" : "open",
    from: d.startAt,
    to: end,
    minutes: Math.max(1, Math.round(exact)),
    price: priceOf(exact),
    paid: false,
  };
  const sref = doc(db, "sessions", `${id}_${d.startAt}`);
  const batch = writeBatch(db);
  batch.set(sref, session);
  batch.update(doc(db, "stations", id), {
    status: "idle", startAt: null, endsAt: null, durationMin: null,
    last: { ...session, id: sref.id },
  });
  await batch.commit();
}

const safeFinish = (id, d) =>
  finishSession(id, d).catch((e) => alert("خطأ في الإنهاء: " + e.message));

function Station({ id, data, now }) {
  const [mins, setMins] = useState("");
  const [menu, setMenu] = useState(false);
  const running = data?.status === "running";
  const isOpen = running && !data.endsAt;
  const last = data?.last;

  const startTimer = async () => {
    const d = parseInt(mins, 10);
    if (!d || d < 1) return alert("اكتب عدد الدقائق");
    const t = Date.now();
    await setDoc(
      doc(db, "stations", id),
      { status: "running", startAt: t, durationMin: d, endsAt: t + d * 60000, last: null },
      { merge: true }
    );
    setMins("");
  };

  const startOpen = async () => {
    await setDoc(
      doc(db, "stations", id),
      { status: "running", startAt: Date.now(), durationMin: null, endsAt: null, last: null },
      { merge: true }
    );
  };

  const forget = () => updateDoc(doc(db, "stations", id), { last: null });
  const collect = async () => {
    if (last.id) await updateDoc(doc(db, "sessions", last.id), { paid: true });
    forget();
  };

  const cls = !running ? "off" : isOpen ? "open" : "on";
  const glyph = GLYPHS[(parseInt(id.replace(/\D/g, ""), 10) - 1) % GLYPHS.length];

  return (
    <section className={`box ${cls}`}>
      <span className="glyph" aria-hidden="true">{glyph}</span>
      <h2>{id}</h2>

      <div className="mid">
        {running ? (
          <>
            {/* هنا التعديل: إذا كانت مفتوحة كيكتب "وقت مفتوح" */}
            <div className="label">
              {isOpen ? "وقت مفتوح" : "المدة المتبقية"}
            </div>
            <div className="big">
              {isOpen ? hms((now - data.startAt) / 1000) : hms((data.endsAt - now) / 1000)}
            </div>
          </>
        ) : last ? (
          <div className="recap">
            <div className="price">{last.price} دج</div>
            <div className="two">
              <button className="b-collect" onClick={collect}>تحصيل</button>
              <button className="b-forget" onClick={forget}>تأجيل</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ctl">
        {!running && (
          <div className="combo">
            <input
              type="number" min="1" inputMode="numeric" value={mins}
              onChange={(e) => setMins(e.target.value)}
              placeholder="شحال دقيقة؟"
            />
            <button className="arrow" onClick={() => setMenu(!menu)} aria-label="اختار المدة">▾</button>
            {menu && (
              <ul className="menu">
                {PRESETS.map((p) => (
                  <li key={p.m}>
                    <button onClick={() => { setMins(String(p.m)); setMenu(false); }}>{p.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="btns">
          {!running && (
            <>
              <button className="b-start" onClick={startTimer}>بدء المؤقت</button>
              <button className="b-open" onClick={startOpen}>فتح وقت</button>
            </>
          )}
          {running && (
            <button className="b-end" onClick={() => safeFinish(id, data)}>إنهاء المؤقت</button>
          )}
        </div>
      </div>
    </section>
  );
}

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const p2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${DAYS[d.getDay()]} ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
const inputValue = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function History({ onStats }) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [list, setList] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [toDelete, setToDelete] = useState(null);
  const [expToDelete, setExpToDelete] = useState(null);
  const [showAddExp, setShowAddExp] = useState(false);
  const isToday = day.getTime() >= startOfDay(new Date()).getTime();

  useEffect(() => {
    const start = day.getTime();
    const end = addDays(day, 1).getTime();
    return onSnapshot(
      query(collection(db, "sessions"), where("from", ">=", start), where("from", "<", end), orderBy("from", "desc")),
      (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [day]);

  useEffect(() => {
    const start = day.getTime();
    const end = addDays(day, 1).getTime();
    return onSnapshot(
      query(collection(db, "expenses"), where("at", ">=", start), where("at", "<", end), orderBy("at", "desc")),
      (s) => setExpenses(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [day]);

  const paid = list.filter((s) => s.paid).reduce((a, s) => a + s.price, 0);
  const totalExp = expenses.reduce((a, s) => a + Number(s.amount || 0), 0);
  const net = paid - totalExp;

  const askRemove = (s) => setToDelete(s);
  const confirmRemove = async () => {
    if (toDelete) await deleteDoc(doc(db, "sessions", toDelete.id));
    setToDelete(null);
  };
  const cancelRemove = () => setToDelete(null);

  const askRemoveExp = (e) => setExpToDelete(e);
  const confirmRemoveExp = async () => {
    if (expToDelete) await deleteDoc(doc(db, "expenses", expToDelete.id));
    setExpToDelete(null);
  };

  const toggle = (s) => updateDoc(doc(db, "sessions", s.id), { paid: !s.paid });

  return (
    <>
      <div className="daybar">
        <div className="dayname">
          <h2>{fmtDate(day)}</h2>
          <input
            type="date" value={inputValue(day)}
            onChange={(e) => {
              if (!e.target.value) return;
              const [y, m, d] = e.target.value.split("-").map(Number);
              setDay(new Date(y, m - 1, d));
            }}
          />
        </div>
      </div>
      <button className="statsbtn" onClick={onStats}>الأرباح</button>
      {!isToday && (
        <button className="today" onClick={() => setDay(startOfDay(new Date()))}>رجوع لليوم</button>
      )}

      <div className="sums">
        <div className={net >= 0 ? "net-pos" : "net-neg"}>
          مجموع اليوم (الصافي)<b>{net} دج</b>
        </div>
      </div>

      <h3 className="section-title">جلسات البلاي</h3>
      {list.length === 0 && <p className="muted">ما كانش لعب في هاد النهار.</p>}
      {list.map((s) => (
        <div key={s.id} className={`row ${s.paid ? "paid" : ""}`}>
          <b className="st">{s.station}</b>
          <span>من {clock(s.from)} إلى {clock(s.to)}</span>
          <span>{s.minutes} دقيقة</span>
          <b>{s.price} دج</b>
          <button onClick={() => toggle(s)}>{s.paid ? "تم التحصيل ✓" : "تحصيل"}</button>
          <button className="del" onClick={() => askRemove(s)}>حذف</button>
        </div>
      ))}

      <div className="section-head">
        <h3 className="section-title" style={{ margin: 0 }}>مصاريف اليوم</h3>
        <button className="add-exp" onClick={() => setShowAddExp(true)}>+ مصروف</button>
      </div>

      {expenses.length === 0 && <p className="muted">ما كانش مصاريف في هاد النهار.</p>}
      {expenses.map((e) => (
        <div key={e.id} className="row expense">
          <b className="st">{e.cat || "أخرى"}</b>
          <span className="exp-desc">{e.note || "—"}</span>
          <span>{clock(e.at)}</span>
          <b>{e.amount} دج</b>
          <span />
          <button className="del" onClick={() => askRemoveExp(e)}>حذف</button>
        </div>
      ))}

      {toDelete && (
        <div className="modal-backdrop" onClick={cancelRemove}>
          <div className="modal confirm" onClick={(ev) => ev.stopPropagation()}>
            <h3>تأكيد الحذف</h3>
            <p className="modal-sub">
              تحذف جلسة <b>{toDelete.station}</b> ({toDelete.minutes} دقيقة — <b>{toDelete.price} دج</b>)؟
            </p>
            <div className="modal-actions">
              <button onClick={cancelRemove}>إلغاء</button>
              <button className="danger" onClick={confirmRemove}>حذف نهائي</button>
            </div>
          </div>
        </div>
      )}

      {expToDelete && (
        <div className="modal-backdrop" onClick={() => setExpToDelete(null)}>
          <div className="modal confirm" onClick={(ev) => ev.stopPropagation()}>
            <h3>تأكيد حذف المصروف</h3>
            <p className="modal-sub">
              تحذف مصروف <b>{expToDelete.cat}</b> ({expToDelete.amount} دج)؟
            </p>
            <div className="modal-actions">
              <button onClick={() => setExpToDelete(null)}>إلغاء</button>
              <button className="danger" onClick={confirmRemoveExp}>حذف نهائي</button>
            </div>
          </div>
        </div>
      )}

      {showAddExp && (
        <AddExpenseModal
          onClose={() => setShowAddExp(false)}
          onSaved={() => setShowAddExp(false)}
        />
      )}
    </>
  );
}

function AddExpenseModal({ onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(EXPENSE_CATS[0]);
  const [customCat, setCustomCat] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const a = parseInt(amount, 10);
    if (!a || a < 1) return alert("اكتب المبلغ");
    
    if (cat === "__custom__" && !customCat.trim()) {
      return alert("اكتب نوع المصروف اللي حبيت");
    }

    setSaving(true);
    try {
      await addDoc(collection(db, "expenses"), {
        amount: a,
        cat: cat === "__custom__" ? customCat.trim() : cat,
        note: note.trim(),
        at: Date.now(),
      });
      onSaved();
    } catch (err) {
      alert("خطأ في الحفظ: " + err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3>مصروف جديد</h3>
        <p className="modal-sub">سجّل مصروف اليوم</p>

        <label className="field">
          <span>المبلغ (دج)</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="مثلاً 500"
          />
        </label>

        <label className="field">
          <span>النوع</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__custom__">✏️ أخرى (اكتبها)</option>
          </select>
        </label>

        {cat === "__custom__" && (
          <label className="field">
            <span>اكتب النوع</span>
            <input
              type="text"
              value={customCat}
              onChange={(e) => setCustomCat(e.target.value)}
              placeholder="مثلاً: كراء الشهر"
            />
          </label>
        )}

        <label className="field">
          <span>ملاحظة (اختياري)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثلاً: شراء ماء ومشروبات"
          />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "..." : "حفظ"}
          </button>
        </div>
      </form>
    </div>
  );
}

const MONTHS = ["جانفي", "فيفري", "مارس", "أفريل", "ماي", "جوان", "جويلية", "أوت", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const KINDS = [["day", "يوم"], ["week", "أسبوع"], ["month", "شهر"], ["year", "سنة"]];

const rangeOf = (kind, r) => {
  const y = r.getFullYear(), m = r.getMonth(), d = r.getDate();
  if (kind === "day") return [new Date(y, m, d), new Date(y, m, d + 1)];
  if (kind === "week") {
    const st = new Date(y, m, d - r.getDay());
    return [st, addDays(st, 7)];
  }
  if (kind === "month") return [new Date(y, m, 1), new Date(y, m + 1, 1)];
  return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
};

function Stats({ onBack }) {
  const [kind, setKind] = useState("day");
  const [ref, setRef] = useState(() => startOfDay(new Date()));
  const [list, setList] = useState([]);
  const [expList, setExpList] = useState([]);
  const [start, end] = rangeOf(kind, ref);

  useEffect(() => {
    const [a, b] = rangeOf(kind, ref);
    return onSnapshot(
      query(collection(db, "sessions"), where("from", ">=", a.getTime()), where("from", "<", b.getTime()), orderBy("from", "desc")),
      (snap) => setList(snap.docs.map((d) => d.data()))
    );
  }, [kind, ref]);

  useEffect(() => {
    const [a, b] = rangeOf(kind, ref);
    return onSnapshot(
      query(collection(db, "expenses"), where("at", ">=", a.getTime()), where("at", "<", b.getTime()), orderBy("at", "desc")),
      (snap) => setExpList(snap.docs.map((d) => d.data()))
    );
  }, [kind, ref]);

  const paidList = list.filter((s) => s.paid);
  const earned = paidList.reduce((a, s) => a + s.price, 0);
  const totalExp = expList.reduce((a, s) => a + Number(s.amount || 0), 0);
  const net = earned - totalExp;

  const groups = {};
  paidList.forEach((s) => {
    const dt = new Date(s.from);
    const key = kind === "day" ? s.station
      : kind === "year" ? MONTHS[dt.getMonth()]
      : `${p2(dt.getDate())}/${p2(dt.getMonth() + 1)}`;
    groups[key] = (groups[key] || 0) + s.price;
  });
  const rows = Object.entries(groups);
  if (kind === "day") rows.sort();

  const label =
    kind === "day" ? fmtDate(start)
    : kind === "week" ? `من ${p2(start.getDate())}/${p2(start.getMonth() + 1)} إلى ${p2(addDays(end, -1).getDate())}/${p2(addDays(end, -1).getMonth() + 1)}/${addDays(end, -1).getFullYear()}`
    : kind === "month" ? `${MONTHS[start.getMonth()]} ${start.getFullYear()}`
    : `${start.getFullYear()}`;

  const timeline = kind === "day" 
    ? [
        ...paidList.map(s => ({ type: "session", time: s.from, data: s })),
        ...expList.map(e => ({ type: "expense", time: e.at, data: e }))
      ].sort((a, b) => b.time - a.time)
    : [];

  return (
    <>
      <button className="statsbtn" onClick={onBack}>رجوع للسجل</button>

      <div className="tabs">
        {KINDS.map(([k, name]) => (
          <button key={k} className={kind === k ? "act" : ""} onClick={() => setKind(k)}>{name}</button>
        ))}
      </div>

      <div className="dayname" style={{ marginBottom: 14 }}>
        <h2>{label}</h2>
        <input
          type="date" value={inputValue(ref)}
          onChange={(e) => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split("-").map(Number);
            setRef(new Date(y, m - 1, d));
          }}
        />
      </div>

      <div className="sums">
        <div className={net >= 0 ? "net-pos" : "net-neg"}>
          مجموع اليوم (الصافي)<b>{net} دج</b>
        </div>
      </div>

      {kind === "day" ? (
        <>
          {timeline.length === 0 && <p className="muted">ما كانش حركة في هاد النهار.</p>}
          {timeline.map((item) => (
            item.type === "session" ? (
              <div key={item.data.id} className="row paid">
                <b className="st">{item.data.station}</b>
                <span>من {clock(item.data.from)} إلى {clock(item.data.to)}</span>
                <span>{item.data.minutes} دقيقة</span>
                <b>{item.data.price} دج</b>
                <span style={{ textAlign: "center" }}>لعب</span>
                <span />
              </div>
            ) : (
              <div key={item.data.id} className="row expense">
                <b className="st">{item.data.cat || "أخرى"}</b>
                <span className="exp-desc">{item.data.note || "—"}</span>
                <span>{clock(item.data.at)}</span>
                <b>{item.data.amount} دج</b>
                <span style={{ textAlign: "center", color: "var(--danger)" }}>مصروف</span>
                <span />
              </div>
            )
          ))}
        </>
      ) : (
        <>
          {rows.length === 0 && <p className="muted">ما كانش تحصيل في هاد الفترة.</p>}
          {rows.map(([k, v]) => (
            <div key={k} className="row two-col">
              <b>{k}</b>
              <b>{v} دج</b>
            </div>
          ))}
        </>
      )}
    </>
  );
}

export default function App() {
  const [page, setPage] = useState("home");
  const [authed, setAuthed] = useState(false);
  const [askPass, setAskPass] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState(false);
  const [stations, setStations] = useState({});
  const [now, setNow] = useState(Date.now());
  const busy = useRef(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "stations"), (s) => {
      const o = {};
      s.forEach((d) => (o[d.id] = d.data()));
      setStations(o);
    });
    return () => u1();
  }, []);

  useEffect(() => {
    STATIONS.forEach((id) => {
      const d = stations[id];
      if (d?.status === "running" && d.endsAt && now >= d.endsAt && !busy.current.has(id)) {
        busy.current.add(id);
        safeFinish(id, d).finally(() => busy.current.delete(id));
      }
    });
  }, [now, stations]);

  const openHistory = () => {
    if (authed) {
      setPage("history");
      return;
    }
    setPassInput("");
    setPassError(false);
    setAskPass(true);
  };

  const submitPass = (e) => {
    e?.preventDefault();
    if (passInput === "123") {
      setAuthed(true);
      setAskPass(false);
      setPage("history");
    } else {
      setPassError(true);
    }
  };

  const closePass = () => {
    setAskPass(false);
    setPassInput("");
    setPassError(false);
  };

  return (
    <div dir="rtl" className="app" style={{ backgroundImage: 'url("/backgronddd.jpg")' }}>
      <style>{css}</style>

      <div className="top">
        <button
          className="nav"
          onClick={() => (page === "home" ? openHistory() : setPage("home"))}
        >
          {page === "home" ? "السجل" : "الرئيسية"}
        </button>
        <h1>{HALL_NAME}</h1>
        <span />
      </div>

      {page === "home" ? (
        <div className="grid">
          {STATIONS.map((id) => (
            <Station key={id} id={id} data={stations[id]} now={now} />
          ))}
        </div>
      ) : page === "history" ? (
        <History onStats={() => setPage("stats")} />
      ) : (
        <Stats onBack={() => setPage("history")} />
      )}

      {askPass && (
        <div className="modal-backdrop" onClick={closePass}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitPass}
          >
            <h3>كلمة السر</h3>
            <p className="modal-sub">اكتب كلمة السر باش تدخل للسجل</p>
            <input
              type="password"
              autoFocus
              value={passInput}
              onChange={(e) => { setPassInput(e.target.value); setPassError(false); }}
              placeholder="كلمة السر"
              className={passError ? "err" : ""}
            />
            {passError && <div className="modal-err">كلمة السر غالطة</div>}
            <div className="modal-actions">
              <button type="button" onClick={closePass}>إلغاء</button>
              <button type="submit" className="primary">دخول</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap');

:root {
  color-scheme: dark;
  --bg:        #0a0b0d;
  --surface:   #111316;
  --surface-2: #16191d;
  --border:    #23272e;
  --border-2:  #2d323a;
  --text:      #e6e8eb;
  --text-dim:  #9aa1ab;
  --text-mute: #6b7280;
  --accent:    #4f8cff;
  --ok:        #3ecf8e;
  --warn:      #e0a33e;
  --danger:    #ef5350;
  --radius:    8px;
}

* { box-sizing: border-box; }

.app {
  min-height: 100vh;
  padding: 28px clamp(14px, 3vw, 40px);
  background-color: var(--bg); 
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  color: var(--text);
  font-family: 'Cairo', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden; 
}

/* ─────────── Top bar ─────────── */
.top {
  display: grid;
  grid-template-columns: 140px 1fr 140px;
  align-items: center;
  gap: 16px;
  max-width: 1480px;
  margin: 0 auto 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.top h1 {
  margin: 0;
  text-align: center;
  font-size: 2.8rem; 
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
  text-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.nav {
  justify-self: start;
  background: var(--surface);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 14px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.nav:hover {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--border-2);
}

/* ─────────── Grid / Flex ─────────── */
.grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  max-width: 1480px;
  margin: 0 auto;
}

/* ─────────── Station card ─────────── */
.box {
  position: relative;
  overflow: visible;
  min-height: 340px;
  
  width: calc(33.333% - 16px); 
  min-width: 280px; 
  max-width: 350px; 
  
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 20px 22px;
  
  background: rgba(17, 19, 22, 0.75); 
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  border: clamp(3px, 0.4vw, 6px) solid #4a2a2c;
  border-radius: var(--radius);
  transition: border-color .15s, background .12s;
}
.box.on   { border-color: var(--ok); }
.box.open { border-color: var(--accent); }
.box:hover { filter: brightness(1.04); }

.glyph {
  position: absolute;
  z-index: 0;
  inset-inline-end: 10px;
  bottom: 0;
  font-size: 6rem;
  line-height: 1;
  color: var(--text);
  opacity: 0.025;
  pointer-events: none;
  user-select: none;
}

.box h2 {
  position: relative;
  z-index: 1;
  margin: 0 0 6px;
  font-size: 2.4rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-align: center;
  align-self: center;
  color: var(--text);
  line-height: 1.1;
}
.box h2::after {
  content: "";
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-inline-start: 12px;
  border-radius: 50%;
  background: var(--danger);
  vertical-align: middle;
  box-shadow: 0 0 0 4px rgba(239,83,80,0.14);
  transition: background .15s, box-shadow .15s;
}
.box.on h2::after {
  background: var(--ok);
  box-shadow: 0 0 0 4px rgba(62,207,142,0.14);
}
.box.open h2::after {
  background: var(--accent);
  box-shadow: 0 0 0 4px rgba(79,140,255,0.14);
}

/* ─────────── Middle timer area ─────────── */
.mid {
  position: relative;
  z-index: 1;
  flex: 1;
  width: 100%;
  min-height: 130px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 0;
}

.label {
  font-size: 1.4rem; 
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.02em;
  text-transform: none;
}

.big {
  font-size: clamp(2rem, 3.4vw, 2.7rem);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  direction: ltr;
  line-height: 1.1;
  color: var(--text);
  letter-spacing: 0.01em;
}

/* ─────────── Controls ─────────── */
.ctl {
  position: relative;
  z-index: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.combo {
  position: relative;
  display: flex;
  width: 100%;
  max-width: 280px;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  overflow: visible;
  transition: border-color .12s;
}
.combo:focus-within { border-color: var(--accent); }

.combo input {
  flex: 1;
  min-width: 0;
  background: transparent;
  color: var(--text);
  border: 0;
  padding: 10px 8px;
  font: inherit;
  font-size: 0.9rem;
  text-align: center;
  -moz-appearance: textfield;
}
.combo input::placeholder { color: var(--text-mute); }
.combo input:focus { outline: 0; }
.combo input::-webkit-inner-spin-button,
.combo input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

.arrow {
  width: 38px;
  flex: 0 0 38px;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.75rem;
  cursor: pointer;
  transition: color .12s;
}
.arrow:hover { background: transparent; color: var(--text); }

.menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0; right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  z-index: 20;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}
.menu button {
  width: 100%;
  padding: 9px 12px;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  text-align: right;
  cursor: pointer;
  border-radius: 5px;
  transition: background .1s;
}
.menu button:hover { background: var(--border); }

.btns {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 280px;
}
.btns button,
.two button {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 10px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface-2);
  color: var(--text-dim);
  transition: background .12s, color .12s, border-color .12s;
}
.btns button:hover,
.two button:hover {
  background: var(--border);
  color: var(--text);
  border-color: var(--border-2);
}

.b-start { color: var(--text); border-color: var(--border-2); }
.b-start:hover { background: var(--border-2); }
.b-open  { color: var(--accent); border-color: #2a3d5c; }
.b-open:hover { background: #1a2438; border-color: #375080; }
.b-end   { color: var(--danger); border-color: #4a2a2c; }
.b-end:hover { background: #2a1b1d; border-color: #6b3a3d; }

/* ─────────── Recap (last session) ─────────── */
.recap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
}
.price {
  font-size: 2rem;
  font-weight: 600;
  line-height: 1;
  color: var(--warn);
  font-variant-numeric: tabular-nums;
}
.two { display: flex; gap: 8px; width: 100%; max-width: 280px; }
.b-collect { color: var(--ok); border-color: #2a4a3c; }
.b-collect:hover { background: #16251f; border-color: #3a6b56; }
.b-forget { color: var(--text-dim); }

/* ─────────── History / Stats ─────────── */
.daybar { display: flex; justify-content: center; margin: 0 auto 16px; }
.dayname {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.dayname h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
}
.dayname input {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
  font: inherit;
  font-size: 0.85rem;
  transition: border-color .12s;
}
.dayname input:focus { outline: 0; border-color: var(--accent); }

.today, .statsbtn {
  display: block;
  margin: 0 auto 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 14px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-dim);
  transition: background .12s, color .12s, border-color .12s;
}
.today:hover, .statsbtn:hover {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--border-2);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-bottom: 16px;
}
.tabs button {
  flex: 1;
  max-width: 110px;
  background: var(--surface);
  color: var(--text-mute);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.tabs button:hover { color: var(--text); border-color: var(--border-2); }
.tabs .act {
  background: var(--surface-2);
  border-color: var(--border-2);
  color: var(--text);
}

/* ─────────── Summary cards ─────────── */
.sums {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin: 0 auto 16px;
  max-width: 1000px;
}
.sums div {
  background: rgba(17, 19, 22, 0.85); 
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-mute);
  font-size: 0.85rem;
  font-weight: 500;
}
.sums b {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.sums .net-pos b { color: var(--ok); }
.sums .net-neg b { color: var(--danger); }

/* ─────────── Section head (مصاريف) ─────────── */
.section-title {
  max-width: 1200px;
  margin: 20px auto 8px;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  padding-inline-start: 2px;
}
.section-head {
  max-width: 1200px;
  margin: 20px auto 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.add-exp {
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 7px 14px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--accent);
  transition: background .12s, color .12s;
}
.add-exp:hover {
  background: var(--accent);
  color: #fff;
}

/* ─────────── Rows (sessions + expenses) ─────────── */
.row {
  display: grid;
  grid-template-columns: 64px minmax(120px, 1fr) 84px 76px 100px 64px;
  gap: 10px;
  align-items: center;
  background: rgba(17, 19, 22, 0.85); 
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 11px 14px;
  margin: 0 auto 6px;
  max-width: 1200px;
  color: var(--text-dim);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  transition: border-color .12s;
}
.row:hover { border-color: var(--border-2); }
.row.two-col { grid-template-columns: 1fr auto; }
.row.paid { border-color: #2a4a3c; }
.row.paid .st { color: var(--ok); }
.row .st { font-size: 0.9rem; font-weight: 600; color: var(--text); }
.row b { color: var(--text); font-weight: 600; }

.row button {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface-2);
  color: var(--text-dim);
  transition: background .12s, color .12s, border-color .12s;
}
.row button:hover { background: var(--border); color: var(--text); }
.row.paid button { color: var(--ok); border-color: #2a4a3c; }
.row .del { color: var(--danger); border-color: #4a2a2c; }
.row .del:hover { background: #2a1b1d; border-color: #6b3a3d; }

.row.expense { border-color: #3a2a2c; }
.row.expense .st { color: var(--danger); }
.exp-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  color: var(--text-mute);
  text-align: center;
  padding: 32px 10px;
  font-size: 0.85rem;
}

.app button:focus-visible,
.app input:focus-visible,
.app select:focus-visible {
  outline: 4px solid var(--accent); 
  outline-offset: 0px;
  border-radius: var(--radius);
}
.app .combo input:focus-visible { outline: none; }

/* ─────────── Modal ─────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
  animation: fadeIn .15s ease-out;
}
.modal {
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 20px 60px rgba(0,0,0,.6);
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: popIn .2s ease-out;
}
.modal h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
}
.modal-sub {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-mute);
}
.modal input,
.modal select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 11px 12px;
  font: inherit;
  font-size: 0.95rem;
  text-align: center;
  transition: border-color .12s;
}
.modal input[type="password"] { letter-spacing: 0.1em; }
.modal input:focus,
.modal select:focus {
  outline: 0;
  border-color: var(--accent);
}
.modal input.err {
  border-color: var(--danger);
  animation: shake .25s ease-in-out;
}
.modal-err {
  color: var(--danger);
  font-size: 0.78rem;
  text-align: center;
  margin-top: -6px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: right;
}
.field > span {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-mute);
}
.field input,
.field select { text-align: right; }
.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.modal-actions button {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface-2);
  color: var(--text-dim);
  transition: background .12s, color .12s, border-color .12s;
}
.modal-actions button:hover {
  background: var(--border);
  color: var(--text);
}
.modal-actions .primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.modal-actions .primary:hover {
  filter: brightness(1.1);
  background: var(--accent);
  color: #fff;
}
.modal-actions .primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.modal-actions .danger {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}
.modal-actions .danger:hover {
  filter: brightness(1.1);
  background: var(--danger);
  color: #fff;
}
.modal.confirm { max-width: 400px; }
.modal.confirm .modal-sub { line-height: 1.7; }
.modal.confirm .modal-sub b { color: var(--text); }

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes popIn {
  from { opacity: 0; transform: scale(.96) translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

/* ─────────── Responsive ─────────── */

/* الشاشات المتوسطة (تابليت) */
@media (max-width: 1024px) {
  .app {
    background-image: url('/red.avif') !important; 
  }
  .top h1 { font-size: 2rem; }
  .label { font-size: 1.2rem; }
}

/* الشاشات الصغيرة (موبايل) */
@media (max-width: 760px) {
  .app { 
    padding: 14px; 
    font-size: 13px; 
    background-image: url('/green.png') !important; 
  }
  .top {
    grid-template-columns: 84px 1fr 0;
    gap: 8px;
    padding-bottom: 14px;
    margin-bottom: 16px;
  }
  .top h1 { font-size: 1.5rem; }
  .nav { padding: 7px 10px; font-size: 0.75rem; }
  .grid { gap: 10px; }
  .box { 
    width: calc(50% - 10px); 
    min-width: 200px;
    min-height: 320px; 
    padding: 42px 16px 18px; 
  }
  .box h2 { font-size: 2rem; }
  .box h2::after { width: 13px; height: 13px; margin-inline-start: 10px; }
  .label { font-size: 1.1rem; }
  .combo, .btns, .two { max-width: 100%; }
  .row { grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.8rem; }
  .row > * { min-width: 0; }
  .row span { overflow-wrap: anywhere; }
}

@media (max-width: 390px) {
  .top { grid-template-columns: 70px 1fr; }
  .top > span { display: none; }
  .btns { flex-direction: column; }
  .big { font-size: 2rem; }
  .box { 
    width: 100%; 
    min-width: 100%;
  }
  .box h2 { font-size: 1.75rem; }
  .label { font-size: 1rem; }
}

@media (prefers-reduced-motion: reduce) {
  .app * { transition: none !important; }
}
`;