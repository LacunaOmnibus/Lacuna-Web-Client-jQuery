define(['jquery', 'lacuna', 'template'], function($, Lacuna, Template) {

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
            zoomLevel           : 1,            // Default zoom level
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

        // We should only need to 'renderStars' when we first display
        // the starmap, when we zoom in/out, or make a big change to
        // our x,y position such that all current tiles go out of range.
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
                    scope.recalculateCentre()
                }
            });
            $starsParent.html('').width(expanseWidthPx).height(expanseHeightPx);

            // First set the position the nine tiles, they will be empty until
            // they are rendered by calls to 'get_star_map'.
            for (var x=0; x<9; x++) {
                var tile = scope.getTileBounds(x);
                // calculate the pixel offset to position the tile on the background
                var absLeft = (tile.left - options.boundLeft) * scope.unitWidthPx();
                var absTop  = (options.boundTop - tile.top) * scope.unitHeightPx();

                var tileHtml = Template.read.mapStar_tile({
                    absLeft     : absLeft,
                    absTop      : absTop,
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
            $starsParent = null; // avoid memory leak
        };

        // After a drag-drop, we need to recalculate the centre tile
        scope.recalculateCentre = function() {
            //alert('get here');
            var $starsParent    = $("#starsParent");
            var $starsViewport  = $("#starsViewport");

            var parentLeft      = parseInt($starsParent.css('left'));
            var parentTop       = parseInt($starsParent.css('top'));
            var viewWidth       = parseInt($starsViewport.width());
            var viewHeight      = parseInt($starsViewport.height());
            var unitX           = Math.round((viewWidth / 2 - parentLeft) / scope.unitWidthPx() + options.boundLeft);
            var unitY           = Math.round(options.boundTop - (viewHeight / 2 - parentTop) / scope.unitHeightPx());
//            alert("parentLeft="+parentLeft+", parentTop="+parentTop+", viewWidth="+viewWidth+", viewHeight="+viewHeight+", unitX="+unitX+", unitY="+unitY);

            // Given, the star unit X,Y we need to see if it falls within any of the 9 currently rendered tiles
            var moveToTile = scope.getTileToMoveTo(unitX,unitY);
            //alert('move to tile '+moveToTile);
            if (moveToTile == -1) {
                // moved totally outside the current 9 tiles, recalculate everything
                scope.renderStars({
                    viewX : unitX,
                    viewY : unitY
                });
            }
            else {
                // Moved somewhere within the outer tiles, do some juggling
                // We can keep some of the existing tiles (but move them)
                //  moveToTile  Move tiles      Replace tiles
                //  0           4,3,1,0
                //  1           5,4,3,2,1,0     0,1,2
                //  2           5,4,2,1
                //  3           7,6,4,3,1,0
                //  4           no change, see above
                //  5           1,2,4,5,7,8
                //  6           3,4,6,7
                //  7           3,4,5,6,7,8    
                //  8           4,5,7,8
                if (moveToTile == 4) {
                    //alert('no tile move');
                }
                else if (moveToTile == 7) {
                    scope.moveTile(3,0);
                    scope.moveTile(4,1);
                    scope.moveTile(5,2);
                    scope.moveTile(6,3);
                    scope.moveTile(7,4);
                    scope.moveTile(8,5);
                    scope.oldCentreTile = _.clone(scope.tiles[4]);
                    scope.renderTile(6);
                    scope.renderTile(7);
                    scope.renderTile(8);
                    // Need to move the position of the tiles
                    for (var x=0; x<9; x++) {
                        $("#starmap_tile"+x).css("top","-=600");
                        $("#starmap_tile_title"+x).css("top","-=600");
                    }
//                    $("#starsParent").css("top","-=600");
                }
                else {
                    scope.renderStars({
                        viewX : unitX,
                        viewY : unitY
                    });
                }
            }
        };
        scope.moveTile = function(from, to) {
            scope.tiles[to] = _.clone(scope.tiles[from]);
            $("#starmap_tile"+to).html($("#starmap_tile"+from).html());
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
        // (in pixels, whiche depends upon zoom level) and then position the stars and planets
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
                                tile_left   : (star.x - tile.left) * scope.unitWidthPx(),
                                tile_top    : (tile.top - star.y) * scope.unitHeightPx(),
                                star_color  : star.color,
                                star_width  : scope.unitWidthPx() * 3,
                                star_height : scope.unitHeightPx() * 3,
                                margin_top  : 5,
                                star_seized : 0
                            });
                            tileHtml += star_div;
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
                Lacuna.alert('Outside bounds');
            }
        };
    };

    return new MapStars();
});


