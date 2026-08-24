// 打刻の「勤務セッション」状態判定（純粋関数）。
//
// 【なぜカレンダー日ではなくセッションで判定するのか】
// 夜勤（例：22:00 出勤 → 翌 07:00 退勤）では、退勤の瞬間は「出勤した日」とは別の日になる。
// 当日(JST)の打刻だけを見る実装だと、翌朝の退勤打刻が「出勤打刻が見つかりません」で拒否され、
// 夜勤スタッフが退勤できない。派遣の現場（工場・倉庫・警備・介護）では夜勤は日常なので致命的。
// そこで「直近の打刻」から状態を導出する。集計エンジン(lib/payroll/aggregate.ts)は
// もともと日跨ぎセッションを正しく扱えるので、これで API と集計の前提が一致する。

/** 出勤打刻から退勤打刻までを1セッションとみなす上限。これを超えたら打刻漏れ扱い（管理者確認）。 */
export const MAX_OPEN_SESSION_HOURS = 24;
/** 退勤直後の誤タップで再出勤してしまうのを防ぐクールダウン。 */
export const RECLOCK_COOLDOWN_MIN = 5;
/**
 * 直近の完了セッションを「本日の状況」として画面に出し続ける時間。
 * 日勤（18:00 退勤 → 翌朝まで表示）を覆いつつ、夜勤明け（07:00 退勤）の人が
 * その日の夜 22:00 に出勤するときには「未出勤」に戻っているよう 12 時間とする。
 */
export const COMPLETED_SESSION_DISPLAY_HOURS = 12;

export type PunchType = "clock_in" | "clock_out";
export type Punch = { type: string; timestamp: string };

export type SessionState =
  | { kind: "idle" }
  /** 勤務中（openedAt から継続。日跨ぎもここに入る） */
  | { kind: "working"; openedAt: string }
  /** 直近の勤務が完了している */
  | { kind: "completed"; openedAt: string | null; closedAt: string }
  /** 出勤打刻が MAX_OPEN_SESSION_HOURS 以上放置されている（退勤打刻漏れ） */
  | { kind: "stale"; openedAt: string };

function hoursSince(ts: string, now: Date): number {
  return (now.getTime() - new Date(ts).getTime()) / 3_600_000;
}

/**
 * 打刻履歴（新しい順）から現在のセッション状態を求める。
 * punches は timestamp の降順で渡すこと。
 */
export function resolveSessionState(punches: Punch[], now: Date = new Date()): SessionState {
  const latest = punches[0];
  if (!latest) return { kind: "idle" };

  if (latest.type === "clock_in") {
    return hoursSince(latest.timestamp, now) >= MAX_OPEN_SESSION_HOURS
      ? { kind: "stale", openedAt: latest.timestamp }
      : { kind: "working", openedAt: latest.timestamp };
  }

  if (latest.type === "clock_out") {
    if (hoursSince(latest.timestamp, now) >= COMPLETED_SESSION_DISPLAY_HOURS) {
      return { kind: "idle" };
    }
    // この退勤に対応する出勤（直前の clock_in）を探す
    const openedAt = punches.slice(1).find((p) => p.type === "clock_in")?.timestamp ?? null;
    return { kind: "completed", openedAt, closedAt: latest.timestamp };
  }

  return { kind: "idle" };
}

export type ClockDecision = { allowed: true } | { allowed: false; status: number; message: string };

/** その打刻を受け付けてよいか判定する。 */
export function canPunch(type: PunchType, state: SessionState, now: Date = new Date()): ClockDecision {
  if (type === "clock_in") {
    if (state.kind === "working") {
      return { allowed: false, status: 409, message: "すでに出勤中です。先に退勤してください" };
    }
    if (
      state.kind === "completed" &&
      hoursSince(state.closedAt, now) * 60 < RECLOCK_COOLDOWN_MIN
    ) {
      return {
        allowed: false,
        status: 409,
        message: `退勤したばかりです。${RECLOCK_COOLDOWN_MIN}分ほど時間をおいてから操作してください`,
      };
    }
    // stale（前回の退勤打刻漏れ）でも当日の出勤は妨げない。
    // 放置された出勤打刻は集計側で needs_review として管理者に上がる。
    return { allowed: true };
  }

  if (state.kind === "working") return { allowed: true };
  if (state.kind === "stale") {
    return {
      allowed: false,
      status: 409,
      message: `出勤打刻から${MAX_OPEN_SESSION_HOURS}時間以上経過しています。管理者にご連絡ください`,
    };
  }
  return { allowed: false, status: 409, message: "出勤打刻が見つかりません" };
}
