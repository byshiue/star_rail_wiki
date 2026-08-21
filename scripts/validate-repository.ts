export async function validateRepository(): Promise<void> {
  return Promise.resolve();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await validateRepository();
}
