import Cryptr from 'cryptr';
import bcrypt from 'bcrypt';

import { userService } from '../user/user.service.js';
import { logger } from '../../services/logger.service.js';

const cryptr = new Cryptr(process.env.SECRET || 'Secret-Puk-1234');

export const authService = {
	signup,
	login,
	getLoginToken,
	validateToken,
};

async function login(username, password) {
	const user = await userService.getByUsername(username);
	if (!user) throw new Error('Invalid username or password');

	const match = await bcrypt.compare(password, user.password);
	if (!match) throw new Error('Invalid username or password');

	delete user.password;
	user._id = user._id.toString();

	// Return user and login token to the controller
	const loginToken = getLoginToken(user);
	return { user, loginToken };
}

async function signup({ username, password, email, imgUrl, isAdmin }) {
	const saltRounds = 10;
	const userExist = await userService.getByUsername(username);
	if (userExist) throw new Error('Username already taken');

	const hash = await bcrypt.hash(password, saltRounds);
	const newUser = await userService.add({ username, password: hash, email, imgUrl, isAdmin });

	// Return user and login token to the controller
	const loginToken = getLoginToken(newUser);
	return { user: newUser, loginToken };
}

function getLoginToken(user) {
	const userInfo = {
		_id: user._id,
		email: user.email,
		isAdmin: user.isAdmin,
		name: user.username,
	};
	return cryptr.encrypt(JSON.stringify(userInfo));
}

function validateToken(loginToken) {
	try {
		const json = cryptr.decrypt(loginToken);
		return JSON.parse(json);
	} catch (err) {
		logger.error('Invalid login token');
		return null;
	}
}
