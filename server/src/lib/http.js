export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectId = (value) => typeof value === "string" && OBJECT_ID.test(value);
