/** "Sigma Nutrition (Prof. Grant Tinsley)" wird zu "Sigma Nutrition · Prof. Grant Tinsley" */
export function speakerLine(channel: string): string {
  const m = channel.match(/^(.*?)\s*\((.+)\)$/);
  return m ? `${m[1]} · ${m[2]}` : channel;
}
