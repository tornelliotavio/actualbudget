import type {
  StatementLine,
  StatementText,
} from '@actual-app/core/server/credit-cards/statements/types';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';

/** Text this close to a line's baseline, in PDF points, is on that line. */
const LINE_TOLERANCE = 2;
/** Runs closer than this are one word split by the PDF, not two columns. */
const JOIN_GAP = 1.5;

type Run = { x: number; end: number; text: string };

function toLines(content: TextContent): StatementLine[] {
  const rows: Array<{ y: number; runs: Run[] }> = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) {
      continue;
    }
    const [, , , , x, y] = item.transform as number[];
    let row = rows.find(
      candidate => Math.abs(candidate.y - y) <= LINE_TOLERANCE,
    );
    if (!row) {
      row = { y, runs: [] };
      rows.push(row);
    }
    row.runs.push({ x, end: x + item.width, text: item.str });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => {
      const cells: Run[] = [];
      for (const run of [...row.runs].sort((a, b) => a.x - b.x)) {
        const last = cells[cells.length - 1];
        if (last && run.x - last.end < JOIN_GAP) {
          last.text += run.text;
          last.end = run.end;
        } else {
          cells.push({ ...run });
        }
      }
      return {
        cells: cells.map(cell => ({
          x: cell.x,
          text: cell.text.replace(/\s+/g, ' ').trim(),
        })),
      };
    });
}

/**
 * The text of a PDF statement with where each run of text sits, which is
 * what tells the columns of a statement apart. The PDF library is loaded
 * here, on first use, so it stays out of the app's startup.
 */
export async function extractStatementText(
  data: Uint8Array,
): Promise<StatementText> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data });
  try {
    const document = await task.promise;
    const pages: StatementLine[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      pages.push(toLines(await page.getTextContent()));
    }
    return { pages };
  } finally {
    await task.destroy();
  }
}
