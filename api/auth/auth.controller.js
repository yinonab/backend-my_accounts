import { authService } from './auth.service.js';
import { logger } from '../../services/logger.service.js';
import { userService } from '../user/user.service.js';

export async function login(req, res) {
	try {
		const { username, password } = req.body;

		// Get user and token from authService
		const { user, loginToken } = await authService.login(username, password);

		logger.info('User login: ', user);

		// Set cookie in the controller
		res.cookie('loginToken', loginToken, {
			httpOnly: true,
			sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // Adjust for environment
			secure: process.env.NODE_ENV === 'production' ? true : false
			, // Use secure cookies only in production
			maxAge: 30 * 24 * 60 * 60 * 1000,
		});
		res.status(200).json({ user, loginToken });

	} catch (err) {
		logger.error('Failed to Login:', err.message);
		res.status(401).send({ err: 'Failed to Login' });
	}
}

export async function facebookLogin(req, res) {
	try {
		const { facebookId, name, email, accessToken } = req.body
		// 1. (Optional) verify accessToken with the FB Graph API if you want.

		// 2. Find if we already have a user with this facebookId or email
		let user = await userService.getByFacebookId(facebookId)
		// (You might need to add getByFacebookId to your userService, 
		//  or do a findOne with { facebookId } or { email })

		// 3. If user doesn’t exist, create it
		if (!user) {
			const newUserData = {
				facebookId,
				username: name,    // or generate a username
				email: email || '',// FB may not always return email
				// password not needed for FB user, but your schema might require something 
				// so you can store a dummy password or handle differently
			}
			user = await userService.addFacebookUser(newUserData)
		}

		// 4. Create an app login token (like in your other login method)
		const { loginToken } = await authService.createLoginTokenForUser(user)

		// 5. Set the cookie
		res.cookie('loginToken', loginToken, {
			httpOnly: true,
			sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
			secure: process.env.NODE_ENV === 'production',
		})

		logger.info(`Facebook login successful for user: ${user.username}`)

		// Return the user object (without sensitive data) 
		// Just like your normal login
		// Or return { user, token } if you prefer
		res.status(200).json(user)
	} catch (err) {
		logger.error('Failed to handle Facebook login:', err.message)
		res.status(401).send({ err: 'Failed to handle Facebook login' })
	}
}

export async function signup(req, res) {
	try {
		console.log('Signup request body:', req.body);

		const credentials = req.body;

		if (!credentials.username || !credentials.password || !credentials.email) {
			throw new Error('Missing required signup information');
		}

		// Get user and token from authService
		const { user, loginToken } = await authService.signup(credentials);

		logger.info('User signup:', user);

		// Set cookie in the controller
		res.cookie('loginToken', loginToken, {
			httpOnly: true,
			sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // Adjust for environment
			secure: process.env.NODE_ENV === 'production' ? true : false
			, // Use secure cookies only in production
		});
		res.status(200).json(user);
	} catch (err) {
		logger.error('Failed to signup:', err.message);
		res.status(400).send({ err: 'Failed to signup' });
	}
}

export async function logout(req, res) {
	try {
		// Clear the loginToken cookie
		res.clearCookie('loginToken', {
			httpOnly: true,
			sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // Adjust for environment
			secure: process.env.NODE_ENV === 'production' ? true : false
			, // Use secure cookies only in production
		});
		res.status(200).send({ msg: 'Logged out successfully' });
	} catch (err) {
		logger.error('Failed to logout:', err.message);
		res.status(400).send({ err: 'Failed to logout' });
	}
}
export async function ping(req, res) {
	console.log("🔄 Keep-Alive Ping התקבל");
	res.status(200).send({ msg: "Session is active" });
}
