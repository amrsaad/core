/** Schlüssel für einen Ausschnitt im Player (mehrere Momente einer Folge teilen die videoId) */
export const localKey = (videoId: string, start: number, end: number | undefined) => `${videoId}|${start}|${end ?? ''}`;
