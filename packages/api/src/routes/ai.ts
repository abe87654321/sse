import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { LocalProvider, SmartFillEngine, InvoiceOCREngine, MinerUProvider, PaddleProvider, VisionOCRProvider } from '@sse/ai';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();
router.use(authMiddleware);

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const CONFIG_PATH = join(process.cwd(), 'ai-config.json');

function loadAiConfig() {
  const defaults = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      model: process.env.AI_MODEL || 'llama3.1:8b',
      enabled: true,
    },
    ocrEngine: {
      provider: 'mineru' as 'mineru' | 'paddle' | 'vision',
      mineruEndpoint: process.env.MINERU_ENDPOINT || 'https://mineru.net',
      paddleEndpoint: process.env.PADDLE_ENDPOINT || 'http://localhost:8899',
      visionEndpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      visionModel: process.env.AI_VISION_MODEL || 'glm-ocr',
      enabled: true,
    },
  };
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...saved,
        fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) },
        ocrEngine: { ...defaults.ocrEngine, ...(saved.ocrEngine || {}) },
      };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function createOCREngine() {
  const config = loadAiConfig();
  const ocrCfg = config.ocrEngine;

  if (ocrCfg.provider === 'mineru') {
    return new InvoiceOCREngine(new MinerUProvider({ endpoint: ocrCfg.mineruEndpoint, apiKey: process.env.MINERU_TOKEN }));
  } else if (ocrCfg.provider === 'paddle') {
    return new InvoiceOCREngine(new PaddleProvider({ endpoint: ocrCfg.paddleEndpoint }));
  } else {
    const provider = new LocalProvider({ endpoint: ocrCfg.visionEndpoint, modelName: ocrCfg.visionModel });
    return new InvoiceOCREngine(new VisionOCRProvider(provider));
  }
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

const aiEndpoint = process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions';
const aiModel = process.env.AI_MODEL || 'llama3.2-vision';
const aiProvider = new LocalProvider({ endpoint: aiEndpoint, modelName: aiModel });
const smartFill = new SmartFillEngine(aiProvider);

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
      const base64 = image.replace(/^data:image\/\w+;base64,/, '');
      items = await smartFill.parseFromImage(base64);
    } else {
      items = await smartFill.parseFromText(text);
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
    const ocrResult = await engine.parseInvoice(file.buffer, file.originalname);
    const items = ocrToExpenseItems(ocrResult);

    res.json({ items });
  })
);

export { router as aiRoutes };
