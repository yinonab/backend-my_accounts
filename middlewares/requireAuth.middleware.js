import { config } from '../config/index.js'
import { logger } from '../services/logger.service.js'
import { asyncLocalStorage } from '../services/als.service.js'
import Cryptr from 'cryptr';

const cryptr = new Cryptr(process.env.SECRET || 'Secret-Puk-1234');


export function requireAuth(req, res, next) {
	console.log('Authorization header:', req.headers['authorization']); // Log the header
	const token = req.headers['authorization']?.split(' ')[1];
	if (!token) return res.status(401).send('Not Authenticated');
	console.log('Token:', token);
	try {
		const decryptedToken = cryptr.decrypt(token);
		const loggedinUser = JSON.parse(decryptedToken);
		req.loggedinUser = loggedinUser;
		console.log('Logged in user:', loggedinUser);
		next();
	} catch (err) {
		console.log('Invalid token:', err.message);
		return res.status(401).send('Invalid token');
	}
}


export function requireAdmin(req, res, next) {
	const { loggedinUser } = asyncLocalStorage.getStore()

	if (!loggedinUser) return res.status(401).send('Not Authenticated')
	if (!loggedinUser.isAdmin) {
		logger.warn(loggedinUser.fullname + 'attempted to perform admin action')
		res.status(403).end('Not Authorized')
		return
	}
	next()
}
