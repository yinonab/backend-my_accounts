import express from 'express'

import { requireAuth } from '../../middlewares/requireAuth.middleware.js'
import { log } from '../../middlewares/logger.middleware.js'

import { getContacts, getContactById, addContact, updateContact, removeContact, addContactMsg, removeContactMsg, getAllContacts } from './contact.controller.js'

const router = express.Router()

// We can add a middleware for the entire router:
// router.use(requireAuth)

router.get('/', log, requireAuth, getContacts)
router.get('/All', log, getAllContacts)
router.get('/:id', log, getContactById)
router.post('/', log, requireAuth, addContact)
router.put('/edit/:id', requireAuth, updateContact)
router.delete('/:id', requireAuth, removeContact)
// router.delete('/:id', requireAuth, requireAdmin, removeContact)

router.post('/:id/msg', requireAuth, addContactMsg)
router.delete('/:id/msg/:msgId', requireAuth, removeContactMsg)

export const contactRoutes = router