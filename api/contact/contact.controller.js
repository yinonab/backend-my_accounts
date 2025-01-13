import { logger } from '../../services/logger.service.js'
import { contactService } from './contact.service.js'

export async function getContacts(req, res) {
	try {
		const filterBy = {
			txt: req.query.txt || '',
			// minSpeed: +req.query.minSpeed || 0,
			// sortField: req.query.sortField || '',
			// sortDir: req.query.sortDir || 1,
			// pageIdx: req.query.pageIdx,
		}
		const contacts = await contactService.query(filterBy)
		res.json(contacts)
	} catch (err) {
		logger.error('Failed to get contacts', err)
		res.status(400).send({ err: 'Failed to get contacts' })
	}
}

export async function getContactById(req, res) {
	try {
		const contactId = req.params.id;
		if (!contactId) {
			return res.status(400).send({ err: 'Contact ID is required' });
		}

		const contact = await contactService.getById(contactId);
		if (!contact) {
			return res.status(404).send({ err: 'Contact not found' });
		}

		res.json(contact);
	} catch (err) {
		logger.error('Failed to get contact', err.message);
		res.status(400).send({ err: err.message || 'Failed to get contact' });
	}
}


export async function addContact(req, res) {
	console.log('Request body:', req.body);
	const { loggedinUser, body: contact } = req

	try {
		console.log('Contact to insert into MongoDB:', contact);
		contact.owner = loggedinUser
		const addedContact = await contactService.add(contact)
		res.json(addedContact)
	} catch (err) {
		logger.error('Failed to add contact', err)
		res.status(400).send({ err: 'Failed to add contact' })
	}
}

export async function updateContact(req, res) {
	const { loggedinUser, body: contact } = req
	const { _id: userId, isAdmin } = loggedinUser

	// if (!isAdmin && contact.owner._id !== userId) {
	// 	res.status(403).send('Not your contact...')
	// 	return
	// }

	try {
		const updatedContact = await contactService.update(contact)
		res.json(updatedContact)
	} catch (err) {
		logger.error('Failed to update contact', err)
		res.status(400).send({ err: 'Failed to update contact' })
	}
}

export async function removeContact(req, res) {
	try {
		const contactId = req.params.id
		const removedId = await contactService.remove(contactId)

		res.send(removedId)
	} catch (err) {
		logger.error('Failed to remove contact', err)
		res.status(400).send({ err: 'Failed to remove contact' })
	}
}

export async function addContactMsg(req, res) {
	const { loggedinUser } = req

	try {
		const contactId = req.params.id
		const msg = {
			txt: req.body.txt,
			by: loggedinUser,
		}
		const savedMsg = await contactService.addContactMsg(contactId, msg)
		res.json(savedMsg)
	} catch (err) {
		logger.error('Failed to update contact', err)
		res.status(400).send({ err: 'Failed to update contact' })
	}
}

export async function removeContactMsg(req, res) {
	try {
		const contactId = req.params.id
		const { msgId } = req.params

		const removedId = await contactService.removeContactMsg(contactId, msgId)
		res.send(removedId)
	} catch (err) {
		logger.error('Failed to remove contact msg', err)
		res.status(400).send({ err: 'Failed to remove contact msg' })
	}
}
