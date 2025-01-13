import { ObjectId } from 'mongodb'

import { logger } from '../../services/logger.service.js'
import { makeId } from '../../services/util.service.js'
import { dbService } from '../../services/db.service.js'
import { asyncLocalStorage } from '../../services/als.service.js'

const PAGE_SIZE = 3

export const contactService = {
	remove,
	query,
	getById,
	add,
	update,
	addContactMsg,
	removeContactMsg,
}

async function query(filterBy = { txt: '' }) {
	try {
		const criteria = _buildCriteria(filterBy)
		const sort = _buildSort(filterBy)

		const collection = await dbService.getCollection('contact')
		var contactCursor = await collection.find(criteria, { sort })

		if (filterBy.pageIdx !== undefined) {
			contactCursor.skip(filterBy.pageIdx * PAGE_SIZE).limit(PAGE_SIZE)
		}

		const contacts = contactCursor.toArray()
		return contacts
	} catch (err) {
		logger.error('cannot find contacts', err)
		throw err
	}
}

async function getById(contactId) {
	try {
		const criteria = { _id: ObjectId.createFromHexString(contactId) }

		const collection = await dbService.getCollection('contact')
		const contact = await collection.findOne(criteria)

		contact.createdAt = contact._id.getTimestamp()
		return contact
	} catch (err) {
		logger.error(`while finding contact ${contactId}`, err)
		throw err
	}
}

async function remove(contactId) {
	const { loggedinUser } = asyncLocalStorage.getStore()
	const { _id: ownerId, isAdmin } = loggedinUser

	try {
		const criteria = {
			_id: ObjectId.createFromHexString(contactId),
		}
		if (!isAdmin) criteria['owner._id'] = ownerId

		const collection = await dbService.getCollection('contact')
		const res = await collection.deleteOne(criteria)

		if (res.deletedCount === 0) throw ('Not your contact')
		return contactId
	} catch (err) {
		logger.error(`cannot remove contact ${contactId}`, err)
		throw err
	}
}

async function add(contact) {
	try {
		console.log('Contact to insert into MongoDB:', contact); // Log the incoming contact
		const collection = await dbService.getCollection('contact');
		const result = await collection.insertOne(contact);
		console.log('MongoDB insert result:', result); // Log the insertion result
		return contact;
	} catch (err) {
		logger.error('Cannot insert contact', err);
		throw err;
	}
}


// async function update(contact) {
// 	const contactToSave = { vendor: contact.vendor, speed: contact.speed }

// 	try {
// 		const criteria = { _id: ObjectId.createFromHexString(contact._id) }

// 		const collection = await dbService.getCollection('contact')
// 		await collection.updateOne(criteria, { $set: contactToSave })

// 		return contact
// 	} catch (err) {
// 		logger.error(`cannot update contact ${contact._id}`, err)
// 		throw err
// 	}
// }

async function update(contact) {
	try {
		// Convert `_id` to an ObjectId
		const criteria = { _id: ObjectId.createFromHexString(contact._id) };

		// Remove `_id` from the contact object since MongoDB doesn't allow updating the `_id` field
		const { _id, ...contactToSave } = contact;

		const collection = await dbService.getCollection('contact');

		// Update the document with the provided fields
		const result = await collection.updateOne(criteria, { $set: contactToSave });

		if (result.matchedCount === 0) {
			throw new Error(`Contact with ID ${contact._id} not found`);
		}

		logger.info(`Contact ${contact._id} updated successfully`);
		return contact; // Return the updated contact object
	} catch (err) {
		logger.error(`Failed to update contact ${contact._id}`, err);
		throw err;
	}
}

async function addContactMsg(contactId, msg) {
	try {
		const criteria = { _id: ObjectId.createFromHexString(contactId) }
		msg.id = makeId()

		const collection = await dbService.getCollection('contact')
		await collection.updateOne(criteria, { $push: { msgs: msg } })

		return msg
	} catch (err) {
		logger.error(`cannot add contact msg ${contactId}`, err)
		throw err
	}
}

async function removeContactMsg(contactId, msgId) {
	try {
		const criteria = { _id: ObjectId.createFromHexString(contactId) }

		const collection = await dbService.getCollection('contact')
		await collection.updateOne(criteria, { $pull: { msgs: { id: msgId } } })

		return msgId
	} catch (err) {
		logger.error(`cannot add contact msg ${contactId}`, err)
		throw err
	}
}


function _buildCriteria(filterBy) {
	const criteria = {};
	if (filterBy.txt) {
		criteria.name = { $regex: filterBy.txt, $options: 'i' }; // Match name containing `txt`
	}
	return criteria;
}


function _buildSort(filterBy) {
	if (!filterBy.sortField) return {}
	return { [filterBy.sortField]: filterBy.sortDir }
}