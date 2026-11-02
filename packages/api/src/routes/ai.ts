import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';
import { createFillProvider, createOCREngine, getSmartFillEngine, loadAiConfig } from '../services/ai-engines';

const router = Router();
router.use(authMiddleware);

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function ocrToExpenseItems(ocr: any) {
  const items: Array<{ categoryName: string; amount: number; expenseDate: string; description: string }> = [];
  const amount = ocr.totalAmount || ocr.amount || 0;
  if (amount > 0) {
    const date = ocr.invoiceDate || new Date().toISOString().slice(0, 10);
    const desc = ocr.sellerName ? `${ocr.sellerName}` : '发票报销';
    items.push({
      categoryName: '其他',
      amount: Number(amount),
      expenseDate: date,
      description: desc,
    });
  }
  return items;
}

const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post(
  '/parse',
  asyncWrap(async (req, res) => {
    const { image, text } = req.body;

    if (!image && !text) {
      throw new AppError(400, 'INVALID_PARAMS', '请提供 image(base64) 或 text 参数');
    }

    const engine = getSmartFillEngine();
    if (!engine) {
      throw new AppError(503, 'AI_DISABLED', '智能填单引擎未启用');
    }

    let items;
    if (image) {
      const base64 = image.replace(/^data:image\/\w+;base64,/, '');
      items = await engine.parseFromImage(base64);
    } else {
      items = await engine.parseFromText(text);
    }

    res.json({ items });
  })
);

router.post(
  '/parse-invoice',
  uploadMemory.single('file'),
  asyncWrap(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new AppError(400, 'INVALID_PARAMS', '请上传发票文件');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'ofd') {
      throw new AppError(400, 'INVALID_PARAMS', '仅支持 PDF 和 OFD 格式的文件');
    }

    const engine = createOCREngine();
    if (!engine) {
      throw new AppError(503, 'OCR_DISABLED', '发票 OCR 引擎未启用');
    }

    const ocrResult = await engine.parseInvoice(file.buffer, file.originalname);
    const items = ocrToExpenseItems(ocrResult);

    res.json({ items });
  })
);

router.post(
  '/polish',
  asyncWrap(async (req, res) => {
    const { body, instruction, previous } = req.body;
    if (!body) throw new AppError(400, 'INVALID_PARAMS', '请提供原文 body');

    const config = loadAiConfig();
    const provider = createFillProvider(config);
    if (!provider) {
      throw new AppError(503, 'AI_DISABLED', '智能填单引擎未启用');
    }

    const prompt = `你是企业通知编辑助手。请润色以下通知，使其更专业、简洁、友好。
保持原意不变，不要添加原文没有的信息。
${instruction ? `用户要求: ${instruction}` : ''}
${previous ? `上次润色版: ${previous}` : ''}

原文: ${body}

请只返回润色后的正文，不要添加任何额外说明。`;

    try {
      const result = await provider.analyzeText(body, prompt);
      res.json({ polished_body: result });
    } catch {
      throw new AppError(500, 'AI_FAILED', '模型调用失败，请检查 AI 配置');
    }
  })
);

export { router as aiRoutes };
