// auth.js
require('dotenv').config();
const { google } = require('googleapis');

const oAuth2Client = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI
);

const scopes = [
	'https://www.googleapis.com/auth/photoslibrary.readonly', // To read photos
	'https://www.googleapis.com/auth/photoslibrary.appendonly', // If you need to upload later
];

function generateAuthUrl() {
	return oAuth2Client.generateAuthUrl({
		access_type: 'offline', // Get a refresh token for long-lived access
		scope: scopes.join(' '),
		prompt: 'consent', // Always show consent screen
	});
}

async function getToken(code) {
	const { tokens } = await oAuth2Client.getToken(code);
	oAuth2Client.setCredentials(tokens);
	return tokens;
}

function setCredentials(tokens) {
	oAuth2Client.setCredentials(tokens);
}

function getOAuth2Client() {
	return oAuth2Client;
}

module.exports = {
	generateAuthUrl,
	getToken,
	setCredentials,
	getOAuth2Client,
};
