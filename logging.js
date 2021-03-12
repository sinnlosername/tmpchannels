const dayjs = require("dayjs");
const chalk = require('chalk');
const autoBind = require('auto-bind');

class Logger {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;

    autoBind(this);
  }

  getFullName() {
    let result = this.name, parent = this.parent;

    while (parent != null) {
      result = parent.name + ":" + result;
      parent = parent.parent;
    }

    return result;
  }

  ok() {
    this.log("ok", Array.from(arguments));
  }

  err() {
    this.log("err", Array.from(arguments));
  }

  log(type, args) {
    const date = dayjs().format('DD.MM.YYYY HH:mm:ss');
    const typeColor = type === "err" ? chalk.red : chalk.blue
    const message = args.map(arg => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return "\n" +arg.stack;
      return JSON.stringify(arg);
    }).join(" ");

    console.log(` ${date} ${this.getFullName()}:${typeColor(type)}  ${message}`);
  }

  childLogger(name) {
    return new Logger(name, this);
  }
}

module.exports = new Logger("");