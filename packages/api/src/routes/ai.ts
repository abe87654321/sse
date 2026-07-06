import { Router, Request, Response, NextFunction } from 'express';
import { LocalProvider, SmartFillEngine } from '@sse/ai';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authMiddleware);

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const aiEndpoint = process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions';
const aiModel = process.env.AI_MODEL || 'llama3.2-vision';
const aiProvider = new LocalProvider({ endpoint: aiEndpoint, modelName: aiModel });
const smartFill = new SmartFillEngine(aiProvider);

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

export { router as aiRoutes };
