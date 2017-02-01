(function() {
'use strict';

  angular
    .module('extractor')
    .controller('appController', appController);

  appController.$inject = ['$scope'];
  function appController($scope) {
    var vm = this;

    const dialog = require('electron').remote.dialog;
    const LinkedImageReader = require('./lib/linked-image-file.js').LinkedImageReader;
    const Readable = require('stream').Readable;
    const fs = require('fs');
    const Jimp = require('jimp');
    const Meanshift = require('meanshift');

    let meanshift = new Meanshift.Meanshift(320, 240, Meanshift.ImageType.MD_RGBA);
    let savedOnce = false;

    let positionMatrix = [];

    let undoStack = [];
    let positionStack = [];

    let globalIdx = 1;

    activate();

    function reset() {
      if (!$scope.filename)
        return;

      var imageReader = $scope.imageReader = new LinkedImageReader($scope.filename);

      imageReader.on('open', function() {
        imageReader.next();
        $scope.$digest();
      });

      imageReader.on('data', function(imageData) {
        var img = new Image();
        img.onload = function() {
          $scope.img = img;
          $scope.sliderValue = $scope.sliderVal = $scope.imageReader.getCurrentPosition();
          if($scope.playing) {
            if(!canShowNext())
              $scope.playing = false;
            else
              setTimeout(next, 20);
          }
          if (savedOnce) {
            drawAll(true, true);
            var ctx = $("#vid")[0].getContext("2d");
            var pos = meanshift.track(new Buffer(ctx.getImageData(0, 0, 320, 240).data), 30);

            $scope.rect.x = pos.x - $scope.rect.width/2;
            $scope.rect.y = pos.y - $scope.rect.height/2;

            drawAll();
          }
          else {
            drawAll();
          }
          $scope.$digest();
        };
        img.src = imageData;
      });

      imageReader.open();
    }

    function openVideo() {
      let filename = dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Linked Image', extensions: ['limg'] }
        ]
      });
      if(!filename || filename.length === 0)
        return;
      
      $scope.filename = filename[0];
      reset();
    }

    function play() {
      $scope.playing = true;
      next();
    }

    function stop() {
      $scope.playing = false;
    }

    function next(preserveStack) {
      if (!preserveStack) {
        undoStack = [];
        positionStack = [];
      }
      $scope.imageReader.next();
    }

    function previous(preserveStack) {
      if (!preserveStack) {
        undoStack = [];
        positionStack = [];
      }
      savedOnce = false;
      $scope.imageReader.previous();
    }

    function canShowNext() {
      return $scope.imageReader && $scope.imageReader.getCurrentPosition() < $scope.imageReader.getNumberOfImages();
    }

    function canShowPrevious() {
      return $scope.imageReader && $scope.imageReader.getCurrentPosition()  > 1;
    }

    function ensureBounds(r)
    {
      let x = r.x < 0 ? 0 : r.x;
      let y = r.y < 0 ? 0 : r.y;

      let width = Math.ceil(r.x + r.width + 1) >= 320 ? Math.floor(320 - r.x - 1) : Math.floor(r.width);
      let height = Math.ceil(r.y + r.height + 1) >= 240 ? Math.floor(240 - r.y - 1) : Math.floor(r.height);

      width -= (x - r.x);
      height -= (y - r.y);

      x = Math.floor(x);
      y = Math.floor(y);
      width = Math.floor(width);
      height = Math.floor(height);

      //keep square
      /*
      width = height = Math.min(width, height);
      let wDiff = r.width - width;

      if(wDiff > 0)
      {
        //recenter
        x += wDiff/2;
        y += wDiff/2;
        width -= wDiff/2;
        height -= wDiff/2;
      }
      */

      return {
        x: x,
        y: y,
        width: width,
        height: height
      };
    }

    function pad(rect, boundedRect, data) {
      let result = [];

      for(let x = 0; x < rect.width; x++)
        for(let y = 0; y < rect.height; y++)
          for(let a = 0; a < 4; a++)
            result.push(255);

      let offsetX = boundedRect.x - rect.x;
      let offsetY = boundedRect.y - rect.y;

      for(let x = 0; x < boundedRect.width; x++) {
        for(let y = 0; y < boundedRect.height; y++) {
          let ry = offsetY + y;
          let rx = offsetX + x;
          for(let a = 0; a < 4; a++) {
            result[(ry*rect.width + rx)*4 + a] = data[(y*boundedRect.width + x)*4 + a];
          }
        }
      }

      return result;
    }

    function floorRect(r) {
      r.x = Math.floor(r.x);
      r.y = Math.floor(r.y);
      r.width = Math.floor(r.width);
      r.height = Math.floor(r.height);
    }

    function save(goNext) {
      if (goNext && !canShowNext())
        return;

      let ctx = $("#vid")[0].getContext("2d");
      drawAll(true, true);
      floorRect($scope.rect);
      let rect = ensureBounds($scope.rect);
      if (!rect)
        return drawAll();
      let imgData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
      let imgArray = pad($scope.rect, rect, imgData.data.slice(0)); //copy
      let x = Math.floor($scope.rect.x + (rect.width/2));
      let y = Math.floor($scope.rect.y + (rect.height/2));

      let position = positionMatrix[Math.floor(y*3/240)][Math.floor(x*3/320)];
      if (!position) {
        console.error('No position found for x ' + x + ' y ' + y);
        return;
      }

      meanshift.initObject(Math.floor(x), Math.floor(y), 20, 20);
      meanshift.track(new Buffer(ctx.getImageData(0, 0, 320, 240).data));
      savedOnce = true;

      new Jimp(Math.floor($scope.rect.width), Math.floor($scope.rect.height), function(err, image) {
        if (err)
          throw err;

        image.bitmap.data = imgArray;
        let i = globalIdx;//position.idx;
        image.write(`samples/${i}.png`, function(err) {
          drawAll();


          if(goNext && canShowNext()) {
            if (undoStack > 50) {
              undoStack.splice(0, 1); //remove the first element
              positionStack.splice(0, 1);
            }
            undoStack.push(`samples/${i}.png`);
            positionStack.push({ x: $scope.rect.x, y: $scope.rect.y });
            next(true);
          }
        });

        position.idx++;
        globalIdx++;
      });
    }

    function equalizeHistogram (src, dst) {
        var srcLength = src.length;
        if (!dst) { dst = src; }

        // Compute histogram and histogram sum:
        var hist = new Float32Array(256);
        var sum = 0;
        for (var i = 0; i < srcLength; ++i) {
            ++hist[~~src[i]];
            ++sum;
        }

        // Compute integral histogram:
        var prev = hist[0];
        for (var i = 1; i < 256; ++i) {
            prev = hist[i] += prev;
        }

        // Equalize image:
        var norm = 255 / sum;
        for (var i = 0; i < srcLength; ++i) {
            dst[i] = hist[~~src[i]] * norm;
        }
        return dst;
    }

    function clipHigh(src, val) {
      for(let i =0; i < src.length; i++) {
        if(src[i] > val) {
          src[i] = val;
        }
      }
    }
    function clipLow(src, val) {
      for(let i =0; i < src.length; i++) {
        if(src[i] < val) {
          src[i] = val;
        }
      }
    }

    $scope.normChanged = drawAll;

    function drawAll(excludeRect, noNormalize) {
      if (!$scope.img)
        return;
      var ctx = $("#vid")[0].getContext("2d");
      ctx.drawImage($scope.img, 0, 0);
      if($scope.normalize && !noNormalize) {
        let data = ctx.getImageData(0, 0, 320, 240);
        clipHigh(data.data, 230);
        clipLow(data.data, 60);
        equalizeHistogram(data.data);
        ctx.putImageData(data, 0, 0);
      }
      if(excludeRect)
        return;
      ctx.beginPath();
      ctx.rect($scope.rect.x, $scope.rect.y, $scope.rect.width, $scope.rect.height);
      ctx.strokeStyle = '#ff0000';
      ctx.stroke();
      ctx.beginPath();
      ctx.rect($scope.rect.x + $scope.rect.width/2 - 10, $scope.rect.y + $scope.rect.height/2 - 10, 20, 20);
      ctx.strokeStyle = '#00ff00';
      ctx.stroke();
    }

    function fixPageXY(e) {
      if (e.pageX == null && e.clientX != null ) { 
        var html = document.documentElement
        var body = document.body

        e.pageX = e.clientX + (html.scrollLeft || body && body.scrollLeft || 0)
        e.pageX -= html.clientLeft || 0
        
        e.pageY = e.clientY + (html.scrollTop || body && body.scrollTop || 0)
        e.pageY -= html.clientTop || 0

      }
      e.adjustedX = e.pageX - 30;
      e.adjustedY = e.pageY - 10;
    }

    function isNear(x1, y1, x2, y2) {
      return Math.sqrt((x1 - x2)*(x1 - x2) + (y1 - y2)*(y1 - y2)) < 7;
    }

    function isNearRect(rect, x, y) {
      var minX = rect.x - 5;
      var minY = rect.y - 5;
      var maxX = rect.x + rect.width + 5;
      var maxY = rect.y + rect.height + 5;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY)
        return true;
      return false;
    }

    function makeDir(dir) {
      try {
        fs.mkdirSync(dir);
      }
      catch(err) { }
    }

    function doSetup() {
      makeDir('samples');
      makeDir('samples/center');
      makeDir('samples/top');
      makeDir('samples/left');
      makeDir('samples/right');
      makeDir('samples/bottom');
      makeDir('samples/topleft');
      makeDir('samples/topright');
      makeDir('samples/bottomleft');
      makeDir('samples/bottomright');

      positionMatrix = [
        [{ pos: 'topleft', idx: 0 },    { pos: 'top', idx: 0 },    { pos: 'topright', idx: 0 }],
        [{ pos: 'left', idx: 0 },       { pos: 'center', idx: 0 }, { pos: 'right', idx: 0 }],
        [{ pos: 'bottomleft', idx: 0 }, { pos: 'bottom', idx: 0 }, { pos: 'bottomright', idx: 0 }]
      ];

      positionMatrix.forEach(function(row) {
        row.forEach(function(cell) {
          var files = fs.readdirSync(`samples/${cell.pos}`);
          var maxFileNum = 1;
          files.forEach(function(f) {
            var fidx = parseInt(f.split('.')[0]);
            if (fidx >= maxFileNum)
              maxFileNum = fidx + 1;
          });
          cell.idx = maxFileNum;
        });
      });

      var files = fs.readdirSync(`samples`);
      var maxFileNum = 1;
      files.forEach(function(f) {
        var fidx = parseInt(f.split('.')[0]);
        if (fidx >= maxFileNum)
          maxFileNum = fidx + 1;
      });
      globalIdx = maxFileNum;
    }

    function undo() {
      if(undoStack.length === 0)
        return;

      var file = undoStack.pop();
      var position = positionStack.pop();
      fs.unlinkSync(file);
      $scope.rect.x = position.x;
      $scope.rect.y = position.y;
      previous(true);
    }

    function restart() {
      $scope.imageReader.reset();
      next();
    }

    function keyPressed(e) {
      if (e.which === 115) { // s
        save(true);
      }
      else if(e.which === 117) { // u
        undo();
      }
    }

    function seek(event, value) {
      $scope.imageReader.seek(value);
    }

    ////////////////

    function activate() {
      $scope.rect = { x: 0, y: 0, width: 30, height: 30 };

      var mode = null;

      document.onmousemove = function(e) {
        if (mode)
          return;
        fixPageXY(e);
        if (isNear(e.adjustedX, e.adjustedY, $scope.rect.x + $scope.rect.width, $scope.rect.y + $scope.rect.height)) {
          $("#vid")[0].style.cursor = "se-resize";
        }
        else if (isNearRect($scope.rect, e.adjustedX, e.adjustedY)) {
          $("#vid")[0].style.cursor = "move";
        }
        else {
          $("#vid")[0].style.cursor = "auto";
        }
      };

      $("#vid")[0].onmousedown = function(e) {
        var self = this;
        fixPageXY(e);

        if (isNear(e.adjustedX, e.adjustedY, $scope.rect.x + $scope.rect.width, $scope.rect.y + $scope.rect.height))
          mode = 'resize';
        else if (isNearRect($scope.rect, e.adjustedX, e.adjustedY))
          mode = 'move';
        else
          return;

        var xOffset = e.adjustedX - $scope.rect.x;
        var yOffset = e.adjustedY - $scope.rect.y;

        $("#vid")[0].onmousemove = function(e) {
          fixPageXY(e);

          if(mode === 'move') {
            $scope.rect.x = e.adjustedX - xOffset;
            $scope.rect.y = e.adjustedY - yOffset;
          }
          else { //resize
            var w = e.adjustedX - $scope.rect.x;
            var h = e.adjustedY - $scope.rect.y;

            var s = Math.min(w, h);

            if (s < 1)
              s = 1;
            
            $scope.rect.width = $scope.rect.height = s;
          }
          drawAll();
        };
        this.onmouseup = function() {
          $("#vid")[0].onmousemove = null;
          $("#vid")[0].style.cursor = "auto";
          mode = null;
          drawAll();
        };
      };

      $("#vid")[0].ondragstart = function() { return false; };

      doSetup();
      
      $scope.openVideo = openVideo;
      $scope.next = next;
      $scope.previous = previous;
      $scope.canShowNext = canShowNext;
      $scope.canShowPrevious = canShowPrevious;
      $scope.play = play;
      $scope.stop = stop;
      $scope.save = save;
      $scope.restart = restart;

      $scope.sliderMin = 1;
      $scope.sliderStep = 1;
      $scope.sliderValue = 1;
      $scope.sliderVal = 1;

      $scope.seek = seek;

      $(document).keypress(keyPressed);
      $scope.$on('$destroy', function() {
        $(document).off('keypress');
      });
     }
  }
})();