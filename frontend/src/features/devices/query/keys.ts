export const deviceKeys = {
  list: ['devices'] as const,
  detail: (id: string) => ['device', id] as const,
};
