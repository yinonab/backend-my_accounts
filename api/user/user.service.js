import { dbService } from '../../services/db.service.js'
import { logger } from '../../services/logger.service.js'
import { reviewService } from '../review/review.service.js'
import { ObjectId } from 'mongodb'

export const userService = {
    add, // Create (Signup)
    getById, // Read (Profile page)
    update, // Update (Edit profile)
    remove, // Delete (remove user)
    query, // List (of users)
    getByUsername, // Used for Login
    updateUserProfile,
    getByFacebookId,
    addFacebookUser,
    updateUserImage,
}

async function query(filterBy = {}) {
    const criteria = _buildCriteria(filterBy)
    try {
        const collection = await dbService.getCollection('user')
        var users = await collection.find(criteria).toArray()
        users = users.map(user => {
            delete user.password
            user.createdAt = user._id.getTimestamp()
            // Returning fake fresh data
            // user.createdAt = Date.now() - (1000 * 60 * 60 * 24 * 3) // 3 days ago
            return user
        })
        return users
    } catch (err) {
        logger.error('cannot find users', err)
        throw err
    }
}

async function updateUserImage(userId, imageUrl) {
    try {
        const collection = await dbService.getCollection('user');
        const updatedUser = await collection.updateOne(
            { _id: new ObjectId(userId) }, // שימוש במילת המפתח `new` כאן
            { $set: { img: imageUrl } }  // עדכון השדה `img`
        );
        return updatedUser;
    } catch (err) {
        logger.error(`Cannot update user image for user ${userId}`, err);
        throw err;
    }
}



async function updateUserProfile(req) {
    const loggedinUser = req.loggedinUser;

    if (!loggedinUser) {
        throw new Error('No logged-in user available');
    }

    // Example logic to update user
    const userToUpdate = {
        _id: loggedinUser._id,
        fullname: req.body.fullname,
        email: req.body.email,
    };

    const updatedUser = await dbService
        .getCollection('user')
        .updateOne({ _id: ObjectId(userToUpdate._id) }, { $set: userToUpdate });

    return updatedUser;
}


async function getById(userId) {
    try {
        var criteria = { _id: ObjectId.createFromHexString(userId) }

        const collection = await dbService.getCollection('user')
        const user = await collection.findOne(criteria)
        delete user.password

        criteria = { byUserId: userId }

        user.givenReviews = await reviewService.query(criteria)
        user.givenReviews = user.givenReviews.map(review => {
            delete review.byUser
            return review
        })

        return user
    } catch (err) {
        logger.error(`while finding user by id: ${userId}`, err)
        throw err
    }
}

async function getByUsername(username) {
    try {
        const collection = await dbService.getCollection('user')
        const user = await collection.findOne({ username })
        return user
    } catch (err) {
        logger.error(`while finding user by username: ${username}`, err)
        throw err
    }
}

async function remove(userId) {
    try {
        const criteria = { _id: ObjectId.createFromHexString(userId) }

        const collection = await dbService.getCollection('user')
        await collection.deleteOne(criteria)
    } catch (err) {
        logger.error(`cannot remove user ${userId}`, err)
        throw err
    }
}

// async function update(user) {
//     try {
//         // peek only updatable properties
//         const userToSave = {
//             _id: ObjectId.createFromHexString(user._id), // needed for the returnd obj
//             fullname: user.fullname,
//             score: user.score,
//         }
//         const collection = await dbService.getCollection('user')
//         await collection.updateOne({ _id: userToSave._id }, { $set: userToSave })
//         return userToSave
//     } catch (err) {
//         logger.error(`cannot update user ${user._id}`, err)
//         throw err
//     }
// }
async function update(user) {
    try {
        // יצירת אובייקט עדכון דינמי
        const userToUpdate = {};

        // בדיקה ועדכון שדות רק אם הם קיימים
        if (user.username) userToUpdate.username = user.username;
        if (user.password) userToUpdate.password = user.password;
        if (user.email) userToUpdate.email = user.email;
        if (user.img) userToUpdate.img = user.img; // שדה התמונה שלך
        if (user.isAdmin !== undefined) userToUpdate.isAdmin = user.isAdmin;

        const collection = await dbService.getCollection('user');

        // עדכון במסד הנתונים
        await collection.updateOne(
            { _id: ObjectId.createFromHexString(user._id) }, // מזהה המשתמש
            { $set: userToUpdate } // עדכון השדות הקיימים
        );

        // החזרת המשתמש המעודכן
        return { ...user, ...userToUpdate };
    } catch (err) {
        logger.error(`cannot update user ${user._id}`, err);
        throw err;
    }
}


async function add(user) {
    try {
        // peek only updatable fields!
        const userToAdd = {
            username: user.username,
            password: user.password,
            email: user.email,
            img: user.img,
            createdAt: Date.now(),
            isAdmin: user.isAdmin,
            // score: 100,
        }
        const collection = await dbService.getCollection('user')
        await collection.insertOne(userToAdd)
        return userToAdd
    } catch (err) {
        logger.error('cannot add user', err)
        throw err
    }
}

function _buildCriteria(filterBy) {
    const criteria = {}
    if (filterBy.txt) {
        const txtCriteria = { $regex: filterBy.txt, $options: 'i' }
        criteria.$or = [
            {
                username: txtCriteria,
            },
            {
                fullname: txtCriteria,
            },
        ]
    }
    if (filterBy.minBalance) {
        criteria.score = { $gte: filterBy.minBalance }
    }
    return criteria
}

// user.service.js
async function getByFacebookId(facebookId) {
    try {
        const collection = await dbService.getCollection('user')
        const user = await collection.findOne({ facebookId })
        return user
    } catch (err) {
        logger.error(`Error finding user by facebookId ${facebookId}`, err)
        throw err
    }
}

async function addFacebookUser({ facebookId, username, email }) {
    try {
        const userToAdd = {
            facebookId,
            username,
            email,
            createdAt: Date.now(),
            isAdmin: false,
        }
        const collection = await dbService.getCollection('user')
        await collection.insertOne(userToAdd)
        return userToAdd
    } catch (err) {
        logger.error('cannot add facebook user', err)
        throw err
    }
}
