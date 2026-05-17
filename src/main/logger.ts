const PREFIX = '[merlin]';

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const logger = {
  info: (...args: unknown[]): void => console.log(PREFIX, ts(), ...args),
  warn: (...args: unknown[]): void => console.warn(PREFIX, ts(), ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ts(), ...args),
  debug: (...args: unknown[]): void => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(PREFIX, ts(), '[debug]', ...args);
    }
  },
};
