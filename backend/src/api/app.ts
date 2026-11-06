import 'express-async-errors'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { logger } from '../logger.js'
import { authRouter } from './routes/auth.js'
import { userRouter } from './routes/user.js'
import { marketplaceRouter } from './routes/marketplace.js'
import { subscriptionsRouter } from './routes/subscriptions.js'
import { creatorRouter } from './routes/creator.js'
import { configRouter } from './routes/config.js'
import { swaggerDocument } from './swagger.js'
import { fail } from './response.js'

export function buildApp(): express.Express {
  const app = express()
  const corsOrigin = process.env.CORS_ORIGIN ?? '*'

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.use(express.json())

  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, 'request')
    next()
  })

  // Mount Swagger UI Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))

  const v1 = express.Router()
  v1.use('/auth', authRouter)
  v1.use('/user', userRouter)
  v1.use('/agents', marketplaceRouter)
  v1.use('/subscriptions', subscriptionsRouter)
  v1.use('/creator', creatorRouter)
  v1.use('/config', configRouter)

  app.use('/api/v1', v1)

  // Final error handler — catches DB errors (and anything else) thrown by
  // route handlers so a single bad request can't crash the whole API.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return

    const pgErr = err as { code?: string; constraint?: string; column?: string }
    if (pgErr?.code === '23505') {
      fail(res, 409, 'Resource already exists', { error_code: 'conflict', constraint: pgErr.constraint })
      return
    }
    if (pgErr?.code === '23502') {
      fail(res, 400, 'Missing required field', { error_code: 'validation_failed', column: pgErr.column })
      return
    }
    if (pgErr?.code === '23503') {
      fail(res, 400, 'Referenced resource does not exist', { error_code: 'validation_failed', constraint: pgErr.constraint })
      return
    }

    logger.error({ err, method: req.method, path: req.path }, 'unhandled request error')
    fail(res, 500, 'Internal server error', { error_code: 'internal_error' })
  })

  return app
}
