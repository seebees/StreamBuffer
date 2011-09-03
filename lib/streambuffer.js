var util        = require('util'),
    Stream      = require('stream').Stream,
    inherit     = function (parent, child) {
      util.inherits(child, parent);
      return child;
    },
    StreamBuffer  = exports.StreamBuffer = inherit(
      Stream,
      function (dest, options) {
        Stream.call(this);
        //private vars
        var buffer  = [],
          total     = 0,
          hasEnded  = false,
          source    = false,
          self      = this,
          destWrite = dest ? dest.write : false;

        options     = options || {};

        // in case you want to buffer a stream while it sets up i.e.
        // I will buffer any writes to you and
        // then read them back to you on .drain()
        if (options.hookWrite) {
          dest.write = self.write;
        }
        // store the source on 'pipe' so I can tell the dest about
        // the source and link the source directly to the dest
        self.on('pipe', function (s) {
          source = s;
          // order is a little strange, someone piped from the buffer
          // before they piped to the buffer.  no problem
          if (pipeOnce) {
            self.drain();
          }
        });

        //basic stream stuff
        self.writable     = true;
        self.readable     = true;
        self.write        = function (chunk, encodeing) {
          // TODO some kind of magic concat?  but then I have
          // accumulation issues, encodeing issues and it is nice
          // that what goes to dest is __exactly__ what came to buffer.
          if (chunk !== undefined && chunk !== null) {
            //store the encodeing
            chunk.encodeing = encodeing;
            buffer.push(chunk);
            total += chunk.length;
  
            if (total > options.size) {
              self.pause();
              self.emit('full');
              return false;
            }
          }
        };

        // a method to drain the buffer and remove it
        // from the equation.
        // if a source and dest sxtream exist, drain will
        // source.pipe(dest);
        // buffer.forEach(dest.write) (waiting for dest.emit('drain'))
        // self.destroy()
        var pipeOnce = false,
            drainMagic;
        self.drain = function () {
          if (source && dest) {
            if (!pipeOnce) {
              if (hasEnded) {
                // if source has ended, then we sould inform dest where it is
                // about to get data from
                dest.emit('pipe', source);
              } else {
                // pause source while we empty buffer
                source.pause();
                // inform dest where it is going to get data from
                source.pipe(dest, options);
                // must remove dest.on('drain') or when I empty the buffer
                // drain events will resume the source
                // which could cause writes to dest to be out of order
                // if source writes on source.resume()
                drainMagic = dest.listeners('drain').pop();
              }
              //don't do it again
              pipeOnce = true;
            }
          }

          if (dest) {
            if (self.readable && empty(dest, destWrite, buffer) !== false) {
              //buffer not empty, wait for drain and try again
              dest.once('drain', function () {
                self.drain();
              });
              return false;
            }
          }

          if (source && dest) {
            //buffer empty, clean up source and dest
            if (hasEnded) {
              if (options.end !== false) {
                //tell dest
                dest.end();
              }
            } else {
              //re-wire dest.on(drain) and resume
              dest.listeners('drain').push(drainMagic);
              source.resume();
            }
          }

          //my work here is done
          self.destroy();
        };

        // drain will handle the complex pipe posibilities
        self.pipe = function() {
          if (!source && !options.hookWrite) {
            Stream.prototype.apply(self, arguments);
            pipeOnce = true;
            //TODO self.write = function(chunk) { self.emit('data', chunk)}?
          }
          dest      = arguments[0];
          options   = arguments[1];
          destWrite = dest.write;
          self.drain();
        };

        // a way to flush the buffer
        self.flush    = function () {
          buffer = [];
          total  = 0;
        };

        self.end      = function () {
          hasEnded = true;
          self.emit('full');
        };

        self.destroy  = function () {
          self.flush();
          self.emit('close');
          self.removeAllListeners();
          if (options.hookWrite) {
            dest.write  = destWrite;
          }
          hasEnded = true;
          self.drain = function () {};
        };

        //TODO should have a hasClosed?
        self.close    = function () {
          hasEnded = true;
        };

        //access to private vars
        self.hasEnded = function () {
          return hasEnded;
        };
        self.source   = function () {
          return source;
        };
        self.dest     = function () {
          return dest;
        }
      }
    );

if (!Stream.prototype.pause) {
  StreamBuffer.prototype.pause = function() {
    this.emit('pause');
  };
}
if (!Stream.prototype.resume) {
  StreamBuffer.prototype.resume = function() {
    this.emit('resume');
  };
}
if (!Stream.prototype.destroySoon) {
  StreamBuffer.prototype.destroySoon = function() {
    this.drain();
  };
}

/**
 *  Helper function to empty a buffer into a dest write stream
 *  Uses the passed write method becuase I may have overridden
 *  dest.write if I am buffering the only the dest stream
 *
 *  will return false if it is unable to empty the buffer,
 *  the caller must handle the drain event
 */
function empty(dest, write, buffer) {
  if (total && dest.writable) {
    for (var i=0, l=buffer.length; i<l; i++) {
      var chunk = buffer.shift(),
          encodeing = chunk.encodeing || false;

        total -= chunk.length;

      // write the chunk, with or without encodeing, this way I don't
      // pass an argument, which might mess someone up,
      // e.g. arugments.length > 1
      if (encodeing &&
          write.call(dest, chunk, encodeing) !== false) {
        return false;
      } else if (write.call(dest, chunk) !== false) {
        return false;
      }
    }
  }
}