import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface WaiverPdfInput {
  academyName: string;
  title: string;
  bodyMarkdown: string;
  memberName: string;
  signerName: string;
  signedAt: string;
  signerIp: string;
  documentVersion: number;
  documentHash: string;
  dateOfBirth?: string | null;
  guardianName?: string | null;
  signatureData: string;
  signatureFormat: 'svg_path' | 'png_data_uri' | 'raw_points';
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 54;

export async function renderWaiverPdf(input: WaiverPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.title} — ${input.memberName}`);
  pdf.setAuthor(input.academyName);
  pdf.setSubject('Signed participation waiver');
  pdf.setCreationDate(new Date(input.signedAt));

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  let y = PAGE_HEIGHT - MARGIN;
  y = drawText(page, input.academyName.toUpperCase(), bold, 9, MARGIN, y, rgb(0.42, 0.42, 0.42));
  y -= 18;
  y = drawText(page, input.title, bold, 18, MARGIN, y, rgb(0.12, 0.1, 0.29));
  y -= 14;
  y = drawRule(page, y);
  y -= 22;

  const body = input.bodyMarkdown
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '');
  for (const paragraph of body.split(/\n{2,}/)) {
    for (const line of wrapText(paragraph.replace(/\n/g, ' '), regular, 10, PAGE_WIDTH - MARGIN * 2)) {
      if (y < 250) break;
      y = drawText(page, line, regular, 10, MARGIN, y, rgb(0.15, 0.15, 0.15));
    }
    y -= 10;
  }

  y = Math.max(y, 230);
  y = drawRule(page, y);
  y -= 20;

  y = drawText(page, 'Signer details', bold, 11, MARGIN, y, rgb(0.12, 0.1, 0.29));
  y -= 16;
  const details = [
    ['Member', input.memberName],
    ['Signed by', input.signerName],
    ['Date of birth', input.dateOfBirth ?? '—'],
    ['Guardian', input.guardianName ?? '—'],
    ['Signed at', input.signedAt],
    ['IP address', input.signerIp],
    ['Document', `v${input.documentVersion} · SHA-256 ${input.documentHash.slice(0, 24)}…`],
  ];
  for (const [label, value] of details) {
    y = drawText(page, `${label}:`, bold, 9, MARGIN, y, rgb(0.35, 0.35, 0.35));
    drawText(page, value ?? '—', regular, 9, MARGIN + 92, y + 0, rgb(0.15, 0.15, 0.15));
    y -= 14;
  }

  y -= 12;
  drawText(page, 'Signature', bold, 9, MARGIN, y, rgb(0.35, 0.35, 0.35));
  const boxY = 70;
  page.drawRectangle({
    x: MARGIN,
    y: boxY,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 110,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.8,
    color: rgb(0.99, 0.99, 0.99),
  });
  await drawSignature(pdf, page, input, MARGIN, boxY);

  drawText(
    page,
    'Electronically signed. The signature, timestamp, IP address and document hash are stored immutably.',
    regular,
    7,
    MARGIN,
    48,
    rgb(0.5, 0.5, 0.5),
  );

  return pdf.save();
}

async function drawSignature(
  pdf: PDFDocument,
  page: PDFPage,
  input: WaiverPdfInput,
  x: number,
  y: number,
): Promise<void> {
  const width = PAGE_WIDTH - MARGIN * 2;
  const height = 110;

  if (input.signatureFormat === 'png_data_uri') {
    const base64 = input.signatureData.split(',')[1];
    if (base64) {
      const image = await pdf.embedPng(Buffer.from(base64, 'base64'));
      const scaled = image.scaleToFit(width - 40, height - 30);
      page.drawImage(image, {
        x: x + (width - scaled.width) / 2,
        y: y + (height - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
      return;
    }
  }

  // SVG path produced by the canvas: "M 12 40 L 30 55 L ..." in a 700x220 box.
  const points: { x: number; y: number }[] = [];
  const pattern = /([ML])\s*([\d.]+)[ ,]+([\d.]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input.signatureData)) !== null) {
    points.push({ x: Number(match[2]), y: Number(match[3]) });
  }
  if (points.length < 2) {
    page.drawText('[signature captured electronically]', {
      x: x + 16,
      y: y + height / 2,
      size: 10,
      font: await pdf.embedFont(StandardFonts.HelveticaOblique),
      color: rgb(0.45, 0.45, 0.45),
    });
    return;
  }

  const scaleX = (width - 60) / 700;
  const scaleY = (height - 30) / 220;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    page.drawLine({
      start: { x: x + 30 + from.x * scaleX, y: y + 15 + (220 - from.y) * scaleY },
      end: { x: x + 30 + to.x * scaleX, y: y + 15 + (220 - to.y) * scaleY },
      thickness: 1.4,
      color: rgb(0.05, 0.05, 0.2),
    });
  }
}

function drawText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  color: ReturnType<typeof rgb>,
): number {
  page.drawText(text, { x, y, size, font, color });
  return y - size - 4;
}

function drawRule(page: PDFPage, y: number): number {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.6,
    color: rgb(0.85, 0.85, 0.85),
  });
  return y - 6;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}
