const success = data => {
  return {
    status: 200,
    message: "OK",
    data
  };
};
const partialSave = data => {
  return {
    status: 207,
    data
  };
};
const noDataSave = data => {
  return {
    status: 204,
    message: "NO CONTENT",
    data
  };
};

const invalid = data => {
  return {
    status: 401,
    data
  };
};

const invalidWithData = data => {
  return {
    status: 409,
    data
  };
};

const errorHandler = error => {
  return {
    status: 500,
    message: error
  };
};

export default {
  success,
  invalid,
  errorHandler,
  partialSave,
  noDataSave,
  invalidWithData
};
