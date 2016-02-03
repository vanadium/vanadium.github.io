var vdlFortune = require('../ifc');

module.exports = FortuneService;

// Define the fortune service.
function FortuneService() {
  this.fortunes = [
    'You will reach the heights of success.',
    'Conquer your fears or they will conquer you.',
    'Today is your lucky day!',
  ];
  this.numFortunesServed = 0;
}

// Add VDL service metadata and type information.
FortuneService.prototype = new vdlFortune.Fortune();

// Define the FortuneServiceMethod bodies.
FortuneService.prototype.add = function(ctx, serverCall, wisdom) {
  this.fortunes.push(wisdom);
}
FortuneService.prototype.get = function(ctx, serverCall) {
  this.numFortunesServed++;
  var fortuneIndex = Math.floor(Math.random() *
    this.fortunes.length);
  return this.fortunes[fortuneIndex];
};
