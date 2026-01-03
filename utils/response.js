const sendResponse = (res, status, message, data = null) => {
  res.status(status).send({
    success: status >= 200 && status < 300,
    message,
    data,
  });
};

module.exports = { sendResponse };
