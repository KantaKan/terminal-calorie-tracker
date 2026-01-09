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

/**
 * Gets the time slot based on the current hour.
 * @returns {string} The time slot ('Morning', 'Afternoon', 'Evening', 'Night').
 */
const getTimeSlot = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return 'Morning';
  }
  if (hour >= 12 && hour < 17) {
    return 'Afternoon';
  }
  if (hour >= 17 && hour < 21) {
    return 'Evening';
  }
  return 'Night';
};

export { getLocalDate, getCurrentTime, getTimeSlot };
