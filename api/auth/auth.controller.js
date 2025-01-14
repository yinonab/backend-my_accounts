import { authService } from './auth.service.js';
import { logger } from '../../services/logger.service.js';

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
		});
		res.status(200).json(user);
	} catch (err) {
		logger.error('Failed to Login:', err.message);
		res.status(401).send({ err: 'Failed to Login' });
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
