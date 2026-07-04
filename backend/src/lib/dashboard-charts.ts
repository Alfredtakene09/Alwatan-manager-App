export type ChartDay = {
  date: string;
  dayLabel: string;
};

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function last7DayStarts(): Date[] {
  const dayStarts: Date[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    dayStarts.push(startOfDay(day));
  }
  return dayStarts;
}

export function formatDayLabel(dayStart: Date) {
  return dayStart.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function chartDays(): ChartDay[] {
  return last7DayStarts().map((dayStart) => ({
    date: dayStart.toISOString().slice(0, 10),
    dayLabel: formatDayLabel(dayStart),
  }));
}

export function bucketByDay<T extends { createdAt: Date }>(
  rows: T[],
  dayStarts: Date[],
  countFn: (row: T, dayStart: Date, dayEnd: Date) => boolean = (row, dayStart, dayEnd) =>
    row.createdAt >= dayStart && row.createdAt < dayEnd,
) {
  return dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const count = rows.filter((row) => countFn(row, dayStart, dayEnd)).length;
    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: formatDayLabel(dayStart),
      count,
    };
  });
}

export function bucketAmountByDay(
  rows: { paidAt: Date | null; amountFcfa: number }[],
  dayStarts: Date[],
) {
  return dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    let totalFcfa = 0;
    for (const row of rows) {
      if (!row.paidAt || row.paidAt < dayStart || row.paidAt >= dayEnd) continue;
      totalFcfa += row.amountFcfa;
    }
    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: formatDayLabel(dayStart),
      totalFcfa,
    };
  });
}
