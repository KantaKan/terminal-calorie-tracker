/**
 * Gets the user's local date as a string in "YYYY-MM-DD" format.
 * This is critical to ensure logs are saved to the correct day regardless of timezone.
 * @returns {string} The formatted date string.
 */
const getLocalDate = () => {
  const date = new Date();
  // Subtract the timezone offset to get the correct local date
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split('T')[0];
};

/**
 * Gets the current time as a string in "HH:mm" format.
 * @returns {string} The formatted time string.
 */
const getCurrentTime = () => {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export { getLocalDate, getCurrentTime };
