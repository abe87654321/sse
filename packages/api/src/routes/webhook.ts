import { Router, Request, Response, NextFunction } from 'express';
import { IdentityBridge } from '../services/identity-bridge';

const router = Router();
const bridge = new IdentityBridge();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.post('/mdm', asyncWrap(async (req, res) => {
  const { event, data, userId } = req.body;
  if (!event || !userId) { res.status(400).json({ error: 'event and userId required' }); return; }
  await bridge.syncFromMdmEvent({ userId, event, data });
  res.json({ received: true });
}));

export { router as webhookRoutes };
