import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';
import {
  createFillProvider,
  createOCREngine,
  getSmartFillEngine,
  getSmartFillVisionEngine,
  loadAiConfig,
} from '../services/ai-engines';

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

    let items;
    if (image) {
      const engine = getSmartFillVisionEngine();
      if (!engine) {
        throw new AppError(
          503,
          'VISION_AI_DISABLED',
          '截图识别视觉模型未启用，请在系统管理中配置',
        );
      }
      const base64 = image.replace(/^data:image\/\w+;base64,/, '');
      items = await engine.parseFromImage(base64);
    } else {
      const engine = getSmartFillEngine();
      if (!engine) {
        throw new AppError(503, 'AI_DISABLED', '智能填单引擎未启用');
      }
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

function cleanPolishedText(raw: string): string {
  let text = String(raw || '').trim();
  // Some models wrap the answer in a fenced block despite the instruction.
  const fenced = text.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  // Drop a leading label such as "润色后：" that some models add.
  text = text.replace(/^(润色后|修改后|优化后)\s*[:：]\s*/u, '');
  return text.trim();
}

router.post(
  '/polish',
  asyncWrap(async (req, res) => {
    const { body, instruction, previous } = req.body;
    const source = typeof body === 'string' ? body.trim() : '';
    if (!source) throw new AppError(400, 'INVALID_PARAMS', '请提供原文 body');
    if (source.length > 20000) {
      throw new AppError(400, 'INVALID_PARAMS', '正文过长，请分段后再润色');
    }

    const config = loadAiConfig();
    if (!config.fillEngine.enabled) {
      throw new AppError(503, 'AI_DISABLED', '系统管理中的智能填单引擎未启用');
    }
    if (!config.fillEngine.endpoint || !config.fillEngine.model) {
      throw new AppError(503, 'AI_NOT_CONFIGURED', '请先在系统管理中配置 AI 模型');
    }

    const provider = createFillProvider(config);
    if (!provider) {
      throw new AppError(503, 'AI_DISABLED', '系统管理中的智能填单引擎未启用');
    }

    const requirement = typeof instruction === 'string' ? instruction.trim() : '';
    const previousDraft = typeof previous === 'string' ? previous.trim() : '';
    const prompt = [
      '你是企业通知编辑助手。请润色用户提供的通知正文。',
      '要求：保持原意不变，不要添加原文没有的信息；语气专业、简洁、友好。',
      requirement ? `用户额外要求：${requirement}` : '',
      previousDraft ? `上一版润色结果（请在此基础上按要求调整）：\n${previousDraft}` : '',
      '只返回润色后的正文，不要添加任何额外说明，不要使用 Markdown 代码块。',
    ].filter(Boolean).join('\n');

    const startedAt = Date.now();
    try {
      const result = cleanPolishedText(await provider.analyzeText(source, prompt));
      if (!result) {
        throw new AppError(502, 'AI_EMPTY_RESPONSE', '模型未返回润色结果，请调整模型或稍后重试');
      }
      res.json({
        polished_body: result,
        model: config.fillEngine.model,
        elapsed_ms: Date.now() - startedAt,
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      const detail = error?.message ? `：${error.message}` : '';
      throw new AppError(502, 'AI_FAILED', `模型调用失败${detail}`);
    }
  })
);

export { router as aiRoutes };
