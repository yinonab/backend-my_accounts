import { ObjectId } from 'mongodb'

import { logger } from '../../services/logger.service.js'
import { makeId } from '../../services/util.service.js'
import { dbService } from '../../services/db.service.js'
import { asyncLocalStorage } from '../../services/als.service.js'
import { log } from '../../middlewares/logger.middleware.js'

const PAGE_SIZE = 3

export const contactService = {
	remove,
	query,
	getById,
	add,
	update,
	addContactMsg,
	removeContactMsg,
	getAllContacts,
}
async function getAllContacts() {
	try {
		console.log("📡 Fetching ALL contacts (no filters)...");

		const collection = await dbService.getCollection('contact');
		const contacts = await collection.find({}).toArray(); // ✅ מחזיר את כל הקונטקטים

		console.log("📥 All Contacts:", contacts);
		return contacts;
	} catch (err) {
		logger.error("❌ Failed to fetch all contacts", err);
		throw err;
	}
}


async function query(filterBy = { txt: '' }, loggedinUser) {
	try {
		const criteria = _buildCriteria(filterBy, loggedinUser); // Pass loggedinUser
		const sort = _buildSort(filterBy);
		console.log('loggedinUser:', loggedinUser); // Log the sort criteria for debugging

		logger.info('Query criteria:', criteria); // Log the criteria for debugging

		const collection = await dbService.getCollection('contact');
		var contactCursor = await collection.find(criteria, { sort });

		if (filterBy.pageIdx !== undefined) {
			contactCursor.skip(filterBy.pageIdx * PAGE_SIZE).limit(PAGE_SIZE);
		}

		let contacts = await contactCursor.toArray();
		// If no contacts exist, create a demo contact
		if (contacts.length === 0) {
			logger.info('No contacts found, creating a demo contact.');
			const demoContact = {
				_id: new ObjectId(), // Generate a new ObjectId for the demo contact
				name: `First Contact of ${loggedinUser.name}`, // Dynamically include the logged-in user's name
				// phone: '123-456-7890',
				// email: 'demo@contact.com',
				// createdAt: new Date(),
				owner: {
					_id: loggedinUser._id,
				},
				// msgs: [],
			};

			await collection.insertOne(demoContact);
			contacts = [demoContact]; // Set the demo contact as the return value
		}

		return contacts;
	} catch (err) {
		logger.error('cannot find contacts', err);
		throw err;
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

// async function remove(contactId) {
// 	const { loggedinUser } = asyncLocalStorage.getStore()
// 	const { _id: ownerId, isAdmin } = loggedinUser

// 	try {
// 		const criteria = {
// 			_id: ObjectId.createFromHexString(contactId),
// 		}
// 		if (!isAdmin) criteria['owner._id'] = ownerId

// 		const collection = await dbService.getCollection('contact')
// 		const res = await collection.deleteOne(criteria)

// 		if (res.deletedCount === 0) throw ('Not your contact')
// 		return contactId
// 	} catch (err) {
// 		logger.error(`cannot remove contact ${contactId}`, err)
// 		throw err
// 	}
// }

async function remove(contactId) {
	try {
		// Convert `contactId` to an ObjectId
		const criteria = { _id: ObjectId.createFromHexString(contactId) };

		const collection = await dbService.getCollection('contact');

		// Delete the document matching the criteria
		const result = await collection.deleteOne(criteria);

		if (result.deletedCount === 0) {
			throw new Error(`Contact with ID ${contactId} not found or not authorized to delete`);
		}

		logger.info(`Contact ${contactId} deleted successfully`);
		return contactId; // Return the deleted contact ID
	} catch (err) {
		logger.error(`Failed to remove contact ${contactId}`, err);
		throw err;
	}
}


async function add(contact) {
	try {
		console.log('Contact to insert into MongoDB:', contact); // Log the incoming contact
		contact.img = contact.img || '';
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

async function update(contactId, updateFields) {
	try {
		if (!contactId) throw new Error('Contact ID is required');
		if (!updateFields || typeof updateFields !== 'object') {
			throw new Error('Update fields must be an object');
		}

		// הסרת השדה `_id` משדות העדכון
		const { _id, ...contactToSave } = updateFields;

		const criteria = { _id: ObjectId.createFromHexString(contactId) };
		const collection = await dbService.getCollection('contact');

		// עדכון המסמך מבלי לשנות את השדה `_id`
		const result = await collection.updateOne(criteria, { $set: contactToSave });

		if (result.matchedCount === 0) {
			throw new Error(`Contact with ID ${contactId} not found`);
		}

		return { _id: contactId, ...contactToSave }; // החזרת הנתונים המעודכנים
	} catch (err) {
		logger.error(`Failed to update contact ${contactId}`, err);
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


// function _buildCriteria(filterBy) {
// 	const criteria = {};
// 	if (filterBy.txt) {
// 		criteria.name = { $regex: filterBy.txt, $options: 'i' }; // Match name containing `txt`
// 	}
// 	return criteria;
// }
function _buildCriteria(filterBy, loggedinUser) {
	const criteria = {};
	if (filterBy.txt) {
		criteria.name = { $regex: filterBy.txt, $options: 'i' }; // Match name containing `txt`
	}
	// Only apply the owner filter if the user is not an admin
	if (loggedinUser && loggedinUser._id && !loggedinUser.isAdmin) {
		criteria['owner._id'] = loggedinUser._id; // Match contacts owned by the logged-in user
	}
	return criteria;
}




function _buildSort(filterBy) {
	if (!filterBy.sortField) return {}
	return { [filterBy.sortField]: filterBy.sortDir }
}