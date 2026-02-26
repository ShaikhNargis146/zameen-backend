class ResponseService {
	static notAuthenticated() {
		return { message: 'NOT_AUTHENTICATED' };
	}
	static sessionExpire() {
		return { message: 'SESSION_EXPIRED' };
	}
}

module.exports = ResponseService;
