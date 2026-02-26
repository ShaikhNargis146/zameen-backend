//Handle the rejection warning or error in while running task in background
module.exports.handleUnhandledRejections = (promise) => {
	promise.catch(() => {});
	return promise;
};
