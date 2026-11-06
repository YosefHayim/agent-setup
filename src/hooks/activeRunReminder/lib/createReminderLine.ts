export type ActiveRun = {
  readonly title: string;
  readonly specPath: string;
  readonly reportPath: string;
};

type ReminderRequest = { readonly activeRun: ActiveRun; readonly isSpecMissing: boolean };

export const createReminderLine = (request: ReminderRequest): string => {
  const { activeRun, isSpecMissing } = request;

  if (isSpecMissing) {
    return `This repo's active-run.json points to a missing spec (${activeRun.specPath}). Tell the user before you continue.`;
  }

  return (
    `This repo has an active run: ${activeRun.title}. If your task is part of this run, read ${activeRun.specPath} in full before you continue. ` +
    "It holds the decided rules, the final structure and each part's checklist, and it wins over anything you remember or were told earlier. " +
    `Re-read your part's checklist in it before every commit. The lead also reads the Handoff section of ${activeRun.reportPath}.`
  );
};
