import express from 'express'

import { login, signup, logout, facebookLogin, ping } from './auth.controller.js'
import { requireAuth } from '../../middlewares/requireAuth.middleware.js'

const router = express.Router()

router.post('/login', login)
router.post('/signup', signup)
router.post('/facebook', facebookLogin)
router.post('/logout', requireAuth, logout)
router.get('/ping', ping)


export const authRoutes = router