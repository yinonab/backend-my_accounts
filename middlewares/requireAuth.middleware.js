import { config } from '../config/index.js'
import { logger } from '../services/logger.service.js'
import { asyncLocalStorage } from '../services/als.service.js'
import Cryptr from 'cryptr';
import { authService } from '../api/auth/auth.service.js';


const cryptr = new Cryptr(process.env.SECRET || 'Secret-Puk-1234');


export async function requireAuth(req, res, next) {
	try {
		//console.log('🛡️ Auth Middleware - Incoming Request');
		//console.log('🔍 Headers:', req.headers);
		//console.log('🍪 Cookies:', req.cookies);


		// בדוק קוקיז קודם
		let loginToken = req.cookies.loginToken;

		// אם אין קוקיז, בדוק Authorization header
		if (!loginToken) {
			const authHeader = req.headers.authorization;
			if (authHeader) {
				// חלץ את הטוקן מהheader (מסיר את המילה 'Bearer')
				loginToken = authHeader.split(' ')[1];
			}
		}

		// בדוק אם טוקן קיים
		if (!loginToken) {
			console.error('Missing loginToken');
			return res.status(401).send({ err: 'Not authenticated' });
		}

		// וודא תקינות הטוקן
		const loggedinUser = authService.validateToken(loginToken);
		if (!loggedinUser) {
			console.error('Invalid or expired loginToken');
			return res.status(401).send({ err: 'Invalid token' });
		}

		// הוסף משתמש מחובר לrequest
		req.loggedinUser = loggedinUser;
		console.log('✅ Authenticated User:', {
			userId: loggedinUser._id,
			email: loggedinUser.email || 'No email',
			role: loggedinUser.isAdmin ? 'Admin' : 'User'
		});

		next();
	} catch (err) {
		console.error('Authentication failed:', err.message);
		res.status(401).send({ err: 'Failed to authenticate' });
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
