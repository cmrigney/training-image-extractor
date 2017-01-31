'use strict';

let EventEmitter = require('events').EventEmitter;
let fs = require('fs');

class LinkedImageReader extends EventEmitter {
  constructor(filename) {
    super();
    this.filename = filename;
    this.numberOfImages = 0;
    this.currentPosition = 0;
    this.inLastPosition = false;
  }

  open() {
    var buff = new Buffer(0);
    fs.stat(this.filename, (err, stats) => {
      this.filesize = stats["size"];

      fs.createReadStream(this.filename, { start: 0, end: 3 })
      .on('data', d => {
        buff = Buffer.concat([buff, d]);
      })
      .on('error', err => {
        this.emit('error', err);
      })
      .on('end', () => {
        this.numberOfImages = buff.readUInt32LE(0);
        this.offset = 4;
        this.isOpen = true;
        this.currentPosition = 0;
        this.emit('open');
      });
    });
  }

  seek(position) {
    if(position === this.currentPosition)
      return;

    if(position > this.numberOfImages)
      return this.emit('error', new Error('Number of images not known'));
    
    if (!this.isOpen)
      return this.emit('error', new Error('file not opened'));

    if (this.doingPrev)
      return this.emit('error', new Error('Busy rewinding'));
    
    if (this.doingNext)
      return this.emit('error', new Error('Busy playing'));
    
    this.seeking = true;

    if (this.currentPosition > position)
      return this._seekBack(position);
    else
      return this._seekForward(position);
  }

  _seekBack(position) {
    var nextPos = this.currentPosition - 1;
    if(nextPos === position || nextPos <= 0) {
      this.seeking = false;
      this.previous(); //regular previous
    }
    else  {
      this.previous(true, () => {
        this._seekBack(position);
      });
    }
  }

  _seekForward(position) {
    var nextPos = this.currentPosition + 1;
    if(nextPos === position || nextPos >= this.numberOfImages) {
      this.seeking = false;
      this.next(); //regular next
    }
    else {
      this.next(true, () => {
        this._seekForward(position);
      });
    }
  }

  reset() {
    if (!this.isOpen)
      return this.emit('error', new Error('file not opened'));
    
    this.offset = 4;
    this.currentPosition = 0;
    this.inLastPosition = false;
  }

  next(isSeek, seekCallback) {
    if (!this.isOpen)
      return this.emit('error', new Error('file not opened'));

    if (this.doingPrev)
      return this.emit('error', new Error('Busy rewinding'));

    if (this.doingNext)
      return;
    this.doingNext = true;
    
    var buff = new Buffer(0);
    fs.createReadStream(this.filename, { start: this.offset, end: this.offset + 8 - 1 })
    .on('data', d => {
      buff = Buffer.concat([buff, d]);
    })
    .on('error', err => {
      this.doingNext = false;
      this.emit('error', err);
    })
    .on('end', () => {
      var prevFileOffset = buff.readUInt32LE(0);
      var filelength = buff.readUInt32LE(4);
      buff = new Buffer(0);

      if (isSeek) {
        this.prevFileOffset = prevFileOffset;
        this.offset += 8 + filelength;
        this.currentPosition++;
        if (this.offset >= this.filesize) {
          this.inLastPosition = true;
        }
        this.doingNext = false;
        return process.nextTick(seekCallback);
      }

      fs.createReadStream(this.filename, { start: this.offset + 8, end: this.offset + 8 + filelength - 1 })
      .on('data', d => {
        buff = Buffer.concat([buff, d]);
      })
      .on('error', err => {
        this.doingNext = false;
        this.emit('error', err);
      })
      .on('end', () => {
        this.prevFileOffset = prevFileOffset;
        this.offset += 8 + filelength;
        this.currentPosition++;
        if (this.offset >= this.filesize) {
          this.inLastPosition = true;
        }
        var htmlImage = `data:image/png;base64,${buff.toString('base64')}`;
        this.doingNext = false;
        this.emit('data', htmlImage);
      });
    });
  }

  previous(isSeek, seekCallback) {
    if (!this.isOpen)
      return this.emit('error', new Error('file not opened'));

    if (this.doingNext)
      return this.emit('error', new Error('Busy going forward'));

    if (!this.prevFileOffset)
      return this.emit('error', new Error('No more files to rewind to'));

    if (this.doingPrev)
      return;
    this.doingPrev = true;
    
    var buff = new Buffer(0);
    fs.createReadStream(this.filename, { start: this.prevFileOffset, end: this.prevFileOffset + 8 - 1 })
    .on('data', d => {
      buff = Buffer.concat([buff, d]);
    })
    .on('error', err => {
      this.doingPrev = false;
      this.emit('error', err);
    })
    .on('end', () => {
      var prevFileOffset = buff.readUInt32LE(0);
      var filelength = buff.readUInt32LE(4);
      buff = new Buffer(0);

      if(isSeek) {
        this.offset = this.prevFileOffset + 8 + filelength;
        this.prevFileOffset = prevFileOffset;
        this.currentPosition--;
        this.inLastPosition = false;
        this.doingPrev = false;
        return process.nextTick(seekCallback);
      }

      fs.createReadStream(this.filename, { start: this.prevFileOffset + 8, end: this.prevFileOffset + 8 + filelength - 1 })
      .on('data', d => {
        buff = Buffer.concat([buff, d]);
      })
      .on('error', err => {
        this.doingPrev = false;
        this.emit('error', err);
      })
      .on('end', () => {
        this.offset = this.prevFileOffset + 8 + filelength;
        this.prevFileOffset = prevFileOffset;
        this.currentPosition--;
        this.inLastPosition = false;
        var htmlImage = `data:image/png;base64,${buff.toString('base64')}`;
        this.doingPrev = false;
        this.emit('data', htmlImage);
      });
    });
  }

  getCurrentPosition() {
    return this.currentPosition;
  }

  getNumberOfImages() {
    return (this.numberOfImages ? this.numberOfImages : (this.inLastPosition ? this.currentPosition : this.currentPosition + 2)); //this allows us to use even unfinished files
  }
}


exports.LinkedImageReader = LinkedImageReader;