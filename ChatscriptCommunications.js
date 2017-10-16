let _ = require("lodash");
let net = require("net");
let Promise = require("bluebird");

let JOIN_SEPARATOR = ":::";

class ChatscriptCommunications {
    constructor () {
        this._port = 1024;
        this._host = "127.0.0.1";
        this._allowHalfOpen = true;
        this._socketTimeout = 5000;
        this._user = (new Date()).getTime();

        this._test = new TestSupport(this);

        let self = this;

        this.start = function () {
            return self._test.say.apply(self._test, arguments);
        };

        this.say = function () {
            return self._test.reply.apply(self._test, arguments);
        }

        this.reply = function () {
            return self._test.reply.apply(self._test, arguments);
        }
    }

    port (_port) {
        this._port = _port;
        return this;
    }

    host (_host) {
        this._host = _host;
        return this;
    }

    bot (botName) {
        if (arguments.length === 0) {
            return this._bot || "";
        } else {
            this._bot = botName;
            return this;
        }
    }

    user (userName) {
        if (arguments.length === 0) {
            return this._user || ".";
        } else {
            this._user = userName;
            return this;
        }
    }

    socketTimeout (_timeout) {
        this._socketTimeout = _timeout;
        return this;
    }

    /**
     * Sends a message to the ChatScript backend
     *
     * @param msg
     * @param options
     */
    message (msg, options) {
        let deferred = Promise.defer();
        let subscription;
        let logs = [];

        options = _.defaults({}, options, {
            bot: this.bot(),                // The bot to talk to.
            username: this.user(),          // The user
            data: null,                     // Data to pass to ChatScript
            disableMessageSizeLimit: false, // This option turns off the message size protection feature - to protect against the 3K data limit on ChatScript
            messageSizeLimit: 3000          // Changes the message size limit
        });

        let configuration = {
            port: this._port,
            host: this._host,
            allowHalfOpen: this._allowHalfOpen
        };

        let errorFunction = function(err) {
            deferred.reject(err);

            chatscriptSocket.destroy();

            // Remove the log tail subscription if we have one
            if (subscription != null) {
                subscription.unsubscribe();
            }
        };

        let chatscriptSocket = net.createConnection(configuration, () => {
            // Set up the message, including data if present
            let adjustedMessage;

            if (options.data) {
                adjustedMessage = "[ " + JSON.stringify(options.data) + " ] " + msg;

                // console.log("Message size: " + adjustedMessage.length);

                if (options.disableMessageSizeLimit == false && adjustedMessage.length >= options.messageSizeLimit) {
                    console.log("ERROR: Message is too long!");
                    errorFunction("ERROR: Message is too long!");
                }

            } else {
                adjustedMessage = "" + msg;
            }

            let payload = options.username + "\x00" + options.bot +"\x00" + adjustedMessage + "\x00";
            chatscriptSocket.write(payload);
        });

        // Set the socket timeout
        chatscriptSocket.setTimeout(this._socketTimeout);
        chatscriptSocket.on('timeout', () => errorFunction('socket timeout'));

        // on receive data from chatscriptSocket
        chatscriptSocket.on("data", function(response) {
            response = "" + response;

            let finalResponse;
            // See if the string contains the separator
            if (response.includes(JOIN_SEPARATOR)) {
                let split = response.split(JOIN_SEPARATOR);

                let responseObj = _.defaults(
                    {
                        text: split[0].trim()
                    },
                    JSON.parse(split[1])
                );

                finalResponse = responseObj;
            } else {
                finalResponse = {
                    text: response
                };
            }
            deferred.resolve(finalResponse);
        });

        // on end from chatscriptSocket
        chatscriptSocket.on("end", function() {
            // console.log("disconnected from server");
            chatscriptSocket.destroy();
        });

        // on error from chatscriptSocket
        chatscriptSocket.on("error", err => errorFunction(err));

        return deferred.promise;
    }
}

class TestSupport {
    constructor (comms) {
        this._padding = "  ";
        this._comms = comms;
    }

    /**
     * Starts a conversation with the bot. Returns a promise so the conversation can flow easily.
     *
     * @param message The message to send. If a string, just passes a string and no data. If an object, expects
     *                   { data: dataToSend, text: "text to send" }
     * @param callback A callback method which accepts the result of the chatscript response. Designed to do your test assertions here
     *
     * @returns {Promise.<TResult>} A Promise which can be chained.
     */
    say (message, callback) {
        let msg, data = {};

        if (typeof message == "string") {
            msg = message;
            console.log("\nUser: " + msg);
        } else {
            data = message;
            msg = message.text || "";
            console.log("\nAUTO: [ " + JSON.stringify(data) + " ] " + msg);
        }

        return this._comms.message(msg, data).then(result => {

            console.log("Bot: " + this.fixText(result.text));

            if (result.actions && result.actions.length > 0) {
                console.log("  Actions:")
                _.each(result.actions, action => {
                    console.log("    " + JSON.stringify(action));
                });
            }
            if (result.prompts != null && result.prompts.length > 0) {
                console.log("  Prompts: " + JSON.stringify(result.prompts))
            }

            if (callback !== undefined) callback(result);

            // console.log("\n");
            return result;
        });
    }

    /**
     * Similar in usage to the <code>say</code> method, but returns a function instead of a promise, which allows simpler
     * promise chaining.
     *
     * @param message Same as above
     * @param callback Same as above
     * @returns {function()}
     */
    reply(message, callback) {
        let self = this;
        return () => {
            return new Promise((resolve, reject) => {
                self.say(message).then(r => {
                    try {
                        callback(r);
                        resolve(r);
                    } catch (ex) {
                        reject(ex);
                    }
                }).catch(ex => reject(ex));
            });
        };
    }

    fixText (text) {
        return text.replace("\t", "\\t");
    }
}

module.exports = ChatscriptCommunications;