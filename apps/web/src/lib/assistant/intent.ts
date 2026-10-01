const percentPattern = /(?:на\s*)?(-?\d+(?:[.,]\d+)?)\s*%/i;
const positionPattern = /(?:позици(?:я|и|ю|ях)|строк(?:а|и|у|ах))\s+([\d.,\s]+)/iu;

export function parseLocalIntent(message: string) {
  const lower = message.toLowerCase();
  const percent = message.match(percentPattern)?.[1]?.replace(",", ".");
  const direction = /уменьш|сниз|сократ|скидк/.test(lower) ? -1 : 1;
  const positionChunk = message.match(positionPattern)?.[1];
  const positions = positionChunk?.split(/[\s,]+/).filter(Boolean);
  return {
    percentage: percent ? Math.abs(Number(percent)) * direction : undefined,
    scope: (/выбран|отмеченн|selected/.test(lower) ? "selected" : positions?.length ? "positions" : "all") as "selected" | "positions" | "all",
    positions,
    undo: /отмен|undo|верни последн/.test(lower),
    read: /покаж|сколько|итог|сумм|прочит|что в/.test(lower),
  };
}
