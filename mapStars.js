define(['jquery', 'underscore', 'lacuna', 'template'], function($, _, Lacuna, Template) {

    Template.load(['mapStars']);

    function MapStars() {
        // Use scope to reduce confusion about this.
        var scope = this;

        // A 'tile' is a block of the starmap 100 units wide by 30 units high
        // Each of these tiles can be populated by a single call to get_star_map
        // Nine of these tiles arranged in a 3x3 grid form the starmap
        // the 'view-port' is a window onto this grid
        // As the map is dragged, some tiles will go out of scope and tiles on
        // the other side will be created (by calls to get_star_map).
        // Since the view-port is generally smaller than a tile (especially at high zoom)
        // then tiles will generally be created outside of the viewport and it will
        // give the appearance of continuous smooth scrolling.

        var defaults = {
            parentContainer     : '#starmap',   // The parent div to contain the starmap
            zoomLevel           : 2,            // Default zoom level
            viewX               : 0,            // The start X unit in the starmap
            viewY               : 0,            // The start Y unit in the starmap
            boundLeft           : -1500,        // Bounds of the starmap
            boundRight          : 1499,         // +1500 has no bodies, so we can ignore it
            boundTop            : 1499,         // Likewise on the Y axis
            boundBottom         : -1500,        // Lower bound
        };
        var options;
        // tiles are an array of 9 tiles arranged by index
        //
        //  6  7  8
        //  3  4  5
        //  0  1  2
        //
        scope.tiles = new Array();
        scope.oldCentreTile = {};

        // convert a zoom level into pixels per starmap 'unit'
        var zoomToPixels = {
            6   : 150,
            5   : 100,
            4   : 75,
            3   : 50,
            2   : 35,
            1   : 20
        };

        // When we move from the central tile (4) to any other tile
        // we can avoid reloading some tiles, we just juggle them 
        // about. These (and their order) are the tiles we can move.
        // TODO There is an edge case, e.g. moving from tile 7 to
        // tile 1 (2 tiles jump) which is slightly inefficent (it
        // calculates all tiles). But it will do for now.
        //
        // TODO It is possible to scroll off the edge of the map. We
        // can probably stop this by putting bounds on the draggable.
        //
        // TODO Minor irritation. When dragging, new tile pops up with
        // what looks like 'old' data which is then overwritten by the
        // call to get_star_map. Clear it out first.
        var juggleTiles = {
            0   : [4,3,1,0],
            1   : [5,4,3,2,1,0],
            2   : [5,4,2,1],
            3   : [7,6,4,3,1,0],
            4   : [],
            5   : [1,2,4,5,7,8],
            6   : [3,4,6,7],
            7   : [3,4,5,6,7,8],
            8   : [4,5,7,8]
        };

        // We should only need to 'renderStars' when we first display
        // the starmap, when we zoom in/out, or make a big change to
        // our x,y position such that all current tiles go out of range.
        //
        // TODO Create a separate function to initialize the data
        //
        scope.renderStars = function(o) {

            // TODO change this to cater for options already defined
            // so we can call it multiple times, but retain old options
            if (typeof o == 'object') {
                options = $.extend(defaults, o);
            }
            else {
                options = defaults;
            }
            // First determine where the centre tile is positioned in the starmap units
            var centreLeft      = Math.floor((options.viewX - options.boundLeft) / 100) * 100 + options.boundLeft;
            var centreBottom    = Math.floor((options.viewY - options.boundBottom) / 30) * 30 + options.boundBottom;
            scope.oldCentreTile = {
                html    : '',
                top     : centreBottom + 29,
                bottom  : centreBottom,
                left    : centreLeft,
                right   : centreLeft + 100
            }

            // The starsParent is the draggable object, it's children (the tiles) can be dragged 
            // with it. Let's make it as big as the expanse (in pixels)
            var expanseWidthPx = scope.unitWidthPx() * (options.boundRight - options.boundLeft);
            var expanseHeightPx = scope.unitHeightPx() * (options.boundTop - options.boundBottom);
            var $starsParent = $("#starsParent");
            $starsParent.draggable({
                stop : function(event, ui) {
                    scope.processDragStop()
                }
            });
            $starsParent.html('').width(expanseWidthPx).height(expanseHeightPx);

            // First set the position the nine tiles, they will be empty until
            // they are rendered by calls to 'get_star_map'.
            for (var x=0; x<9; x++) {
                var tile    = scope.getTileBounds(x);
                var tileAbs = scope.getTileAbsPosition(x);

                var tileHtml = Template.read.mapStar_tile({
                    absLeft     : tileAbs.left,
                    absTop      : tileAbs.top,
                    x           : tile.left,
                    y           : tile.top,
                    tileId      : x,
                    widthPx     : 100 * scope.unitWidthPx(),
                    heightPx    : 30 * scope.unitHeightPx(),
                });
                $starsParent.append(tileHtml);
                scope.tiles[x].html = tileHtml;
            }

            // Render all 9 tiles
            // TODO: We should render all tiles that are visible first
            // but for now render the centre tile first
            scope.renderTile(4);
            for (var x=0; x < 9; x++) {
                if (x != 4) {
                    scope.renderTile(x);
                }
            }
            // Get the size of the viewport so we can position the target in the centre of the screen
            var $starsViewport = $("#starsViewport");
            var viewWidth = $starsViewport.width();
            var viewHeight = $starsViewport.height();
            var left = viewWidth / 2 - (options.viewX - options.boundLeft) * scope.unitWidthPx();
            var top = viewHeight / 2 - (options.boundTop - options.viewY) * scope.unitHeightPx();
            $starsParent.css('left', left);
            $starsParent.css('top', top);
            $starsParent = null; // avoid potential memory leak
        };

        // After a drag-drop, we need to recalculate the tiles
        scope.processDragStop= function() {
            //alert('get here');
            var $starsParent    = $("#starsParent");
            var $starsViewport  = $("#starsViewport");

            var parentLeft      = parseInt($starsParent.css('left'));
            var parentTop       = parseInt($starsParent.css('top'));
            var viewWidth       = parseInt($starsViewport.width());
            var viewHeight      = parseInt($starsViewport.height());
            var unitX           = Math.round((viewWidth / 2 - parentLeft) / scope.unitWidthPx() + options.boundLeft);
            var unitY           = Math.round(options.boundTop - (viewHeight / 2 - parentTop) / scope.unitHeightPx());

            // Given, the star unit X,Y we need to see if it falls within any of the 9 currently rendered tiles
            var moveToTile = scope.getTileToMoveTo(unitX,unitY);
            if (moveToTile == -1) {
                // moved totally outside the current 9 tiles, recalculate everything
                // TODO it is possible that we have moved the centre tile outside of
                // any existing tiles, but some edge tiles might still be reusable.
                // Look at this later.
                scope.renderStars({
                    viewX : unitX,
                    viewY : unitY
                });
            }
            else if (moveToTile != 4) {
                // tile 4 means 'no movement', so omit it
                var delta = 4 - moveToTile;
                var tiles = _.clone(juggleTiles[moveToTile]);
                var tilesToDo = [0,1,2,3,4,5,6,7,8];
                while(tiles.length) {
                    var tile = tiles.shift();
                    scope.moveTile(tile,tile+delta);
                    // remove this tile from tilesToDo (native indexOf not supported in IE 8 or below)
                    tilesToDo.splice(_.indexOf(tilesToDo, tile+delta), 1);
                }
                scope.oldCentreTile = _.clone(scope.tiles[4]);
                // render the remaining tiles.
                while(tilesToDo.length) {
                    var tile = tilesToDo.shift();
                    scope.renderTile(tile);
                }
                // Now adjust the position of all of the tiles
                for (var x=0; x<9; x++) {
                    var tileAbs = scope.getTileAbsPosition(x);
                    $("#starmap_tile"+x).css("top",tileAbs.top).css("left",tileAbs.left);
                    $("#starmap_tile_title"+x).css("top",tileAbs.top).css("left",tileAbs.left);
                }
            }
        };
        // Get the pixel location of the tile on the draggable background
        scope.getTileAbsPosition = function(tileId) {
            var tile    = scope.tiles[tileId];
            return {
                left    : (tile.left - options.boundLeft) * scope.unitWidthPx(),
                top     : (options.boundTop - tile.top) * scope.unitHeightPx()
            };
        };
        // Move a tile and adjust the html for that tile
        scope.moveTile = function(from, to) {
            scope.tiles[to] = _.clone(scope.tiles[from]);
            $("#starmap_tile"+to).html($("#starmap_tile"+from).html());
            $("#starmap_tile"+from).html('');
            // the following is only temporary, for debug purposes.
            $("#starmap_tile_title"+to).html("&nbsp;&nbsp; tile "+to+", "+scope.tiles[to].left+"|"+scope.tiles[to].top);
        };

        // The expanse is tiled in fixed size tiles 100 units wide by 30 units high.
        // We can break the starmap into 30 tiles wide (ignoring x=1500 since it
        // does not contain any bodies) and 100 tiles high (again ignoring y=1500)
        // Taking advantage of this makes the code a bit easier. This may change in the
        // future when we have the basic code working.
        //
        // We can position the tile in a parent div with an area equivalent to the size of the expanse
        // (in pixels, which depends upon zoom level) and then position the stars and planets
        // absolutely within the tile.
        //
        scope.unitWidthPx = function() {
            return zoomToPixels[options.zoomLevel];
        };
        scope.unitHeightPx = function() {
            return zoomToPixels[options.zoomLevel];
        };

        // Given a star unit X,Y location, work out which of the existing tiles have we moved to
        // (or return -1 if we are out of range of all existing tiles)
        scope.getTileToMoveTo = function(unitX, unitY) {
            var xDelta  = (Math.floor((unitX - options.boundLeft)/100) * 100 + options.boundLeft - scope.oldCentreTile.left) / 100;
            var yDelta  = (Math.floor((unitY - options.boundBottom)/30) * 30 + options.boundBottom + 29 - scope.oldCentreTile.top) / 30;
            //alert("xDelta="+xDelta+", yDelta="+yDelta);
            if (Math.abs(xDelta) < 2 && Math.abs(yDelta) < 2) {
                return 4 + yDelta * 3 + xDelta;
            }
            return -1;      // Out of range of all tiles
        };

        // tileId is the tile who's position we want to find
        // by referring to the central tile
        //
        scope.getTileBounds = function(tileId) {
            scope.tiles[tileId] = {};
            // xDelta and yDelta are the tile offsets to the centre tile
            var yDelta  = Math.floor((8 - tileId)/3) - 1;
            var xDelta  = tileId % 3 - 1;
            // Convert to position for the specified tileId (in starmap units)
            var left    = scope.oldCentreTile.left + xDelta * 100;
            var top     = scope.oldCentreTile.top - yDelta * 30;
            scope.tiles[tileId] = {
                html    : '',
                left    : left,
                top     : top,
                right   : left + 99,
                bottom  : top - 29
            };
            return scope.tiles[tileId];
        };

        // Render a single tile given it's ID (0-9)
        scope.renderTile = function(tileId) {
            scope.getTileBounds(tileId);
            var tile = scope.tiles[tileId];

            if (    tile.left   >= options.boundLeft 
                &&  tile.right  <= options.boundRight
                &&  tile.bottom >= options.boundBottom
                &&  tile.top    <= options.boundTop) {
                // Then we are within the bounds of the starmap
                Lacuna.send({
                    module: '/map',
                    method: 'get_star_map',
                    params: [{
                        session_id  : Lacuna.getSession(),
                        left        : tile.left,
                        top         : tile.top,
                        right       : tile.right,
                        bottom      : tile.bottom
                    }],
                    success : function(o) {
                        var stars = o.result.stars;
                        var tileHtml = '';

                        // Map each star onto the tile
                        for (var i = 0; i < stars.length; i++) {
                            var star = stars[i];
                            var star_div = Template.read.mapStar_star({
                                assetsUrl   : window.assetsUrl,
                                id          : star.id,
                                x           : star.x,
                                y           : star.y,
                                name        : star.name,
                                tile_width  : scope.unitWidthPx() * 3,
                                tile_height : scope.unitHeightPx() * 3,
                                tile_left   : (star.x - tile.left - 1) * scope.unitWidthPx(),
                                tile_top    : (tile.top - star.y - 1) * scope.unitHeightPx(),
                                star_color  : star.color,
                                star_width  : scope.unitWidthPx() * 3,
                                star_height : scope.unitHeightPx() * 3,
                                margin_top  : 5,
                                star_seized : 0
                            });
                            tileHtml += star_div;
                            // Map each planet of this star onto the tile
                            var bodies = star.bodies;
                            for (var b=0; b<bodies.length; b++) {
                                var body = bodies[b];
                                var body_div = Template.read.mapStar_body({
                                    assetsUrl   : window.assetsUrl,
                                    id          : body.id,
                                    x           : body.x,
                                    y           : body.y,
                                    name        : body.name,
                                    tile_width  : scope.unitWidthPx(),
                                    tile_height : scope.unitHeightPx(),
                                    tile_left   : (body.x - tile.left) * scope.unitWidthPx(),
                                    tile_top    : (tile.top - body.y) * scope.unitHeightPx(),
                                    body_image  : body.image,
                                    body_orbit  : body.orbit,
                                    body_width  : scope.unitWidthPx(),
                                    body_height : scope.unitWidthPx(),
                                    planet_occupied : 0,            // for now
                                    margin_top  : 5
                                });
                                tileHtml += body_div;
                            }
                        }
                        scope.tiles[tileId].html = tileHtml;
                        $("#starmap_tile"+tileId).html(tileHtml);
                        // The following is only temporary for debug purposes
                        $("#starmap_tile_title"+tileId).html("&nbsp;&nbsp; tile "+tileId+", "+scope.tiles[tileId].left+"|"+scope.tiles[tileId].top);
                        // Now populate the tile with the ships
                    }
                });
            }
            else {
                // Then we are outside the bounds, just render a starfield
                // (we may not need to render anything if we have a tiled background image)
            }
        };
    };

    return new MapStars();
});


