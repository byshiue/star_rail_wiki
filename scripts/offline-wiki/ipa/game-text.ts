type Parameter = { Value?: unknown };

function displayNumber(value: number, format: string, percent: boolean): string {
  const scaled = percent ? value * 100 : value;
  const fixed = /^f(\d+)$/u.exec(format);
  if (fixed) return scaled.toFixed(Number(fixed[1]));
  if (format === "i") return String(Math.round(scaled));
  return String(Number(scaled.toFixed(6)));
}

export function formatGameText(template: string, parametersValue: unknown): string {
  const parameters = Array.isArray(parametersValue) ? parametersValue as Parameter[] : [];
  const substituted = template.replace(/#(\d+)\[([a-z]\d*)\](%?)/giu, (match, indexText: string, format: string, percentMark: string) => {
    const parameter = parameters[Number(indexText) - 1]?.Value;
    return typeof parameter === "number" && Number.isFinite(parameter)
      ? `${displayNumber(parameter, format.toLowerCase(), percentMark === "%")}${percentMark}`
      : match;
  });
  return substituted
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/?(?:color(?:=[^>]*)?|unbreak)>/giu, "")
    .replace(/<\/?(?:b|i|u)>/giu, "");
}
