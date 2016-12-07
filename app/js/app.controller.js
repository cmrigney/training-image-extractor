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
          if($scope.playing) {
            if(!canShowNext())
              $scope.playing = false;
            else
              setTimeout(next, 20);
          }
          if (savedOnce) {
            drawAll(true);
            var ctx = $("#vid")[0].getContext("2d");
            var pos = meanshift.track(new Buffer(ctx.getImageData(0, 0, 320, 240).data));

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
      if (!preserveStack)
        undoStack = [];
      $scope.imageReader.next();
    }

    function previous(preserveStack) {
      if (!preserveStack)
        undoStack = [];
      $scope.imageReader.previous();
    }

    function canShowNext() {
      return $scope.imageReader && $scope.imageReader.getCurrentPosition() < $scope.imageReader.getNumberOfImages() - 1;
    }

    function canShowPrevious() {
      return $scope.imageReader && $scope.imageReader.getCurrentPosition()  > 1;
    }

    function save(goNext) {
      if (goNext && !canShowNext())
        return;

      let ctx = $("#vid")[0].getContext("2d");
      drawAll(true);
      let imgData = ctx.getImageData($scope.rect.x, $scope.rect.y, $scope.rect.width, $scope.rect.height);
      let x = $scope.rect.x + ($scope.rect.width/2);
      let y = $scope.rect.y + ($scope.rect.height/2);

      let position = positionMatrix[Math.floor(y*3/240)][Math.floor(x*3/320)];
      if (!position) {
        console.error('No position found for x ' + x + ' y ' + y);
        return;
      }

      meanshift.initObject(Math.floor(x), Math.floor(y), 20, 20);
      meanshift.track(new Buffer(ctx.getImageData(0, 0, 320, 240).data));
      savedOnce = true;

      new Jimp($scope.rect.width, $scope.rect.height, function(err, image) {
        if (err)
          throw err;

        image.bitmap.data = imgData.data;
        let i = position.idx;
        image.write(`samples/${position.pos}/${i}.png`, function(err) {
          drawAll();


          if(goNext && canShowNext()) {
            if (undoStack > 50) {
              undoStack.splice(0, 1); //remove the first element
            }
            undoStack.push(`samples/${position.pos}/${i}.png`);
            next(true);
          }
        });

        position.idx++;
      });
    }

    function drawAll(excludeRect) {
      if (!$scope.img)
        return;
      var ctx = $("#vid")[0].getContext("2d");
      ctx.drawImage($scope.img, 0, 0);
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
      e.adjustedX = e.pageX - 15;
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
    }

    function undo() {
      if(undoStack.length === 0)
        return;

      var file = undoStack.pop();
      fs.unlinkSync(file);
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

      $(document).keypress(keyPressed);
      $scope.$on('$destroy', function() {
        $(document).off('keypress');
      });
     }
  }
})();